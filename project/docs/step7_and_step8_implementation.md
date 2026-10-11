# StackPrep — Step 7 & Step 8 Implementation Reference

This document summarizes the end-to-end architecture, API contracts, execution flows, validation rules, guardrails, and verification scenarios implemented in **Step 7 (Question Generation)** and **Step 8 (Answer Evaluation)**.

---

## 1. System Architecture & Flow Overview

```
                      [ Client / Frontend ]
                                |
                (Bearer JWT / Cookie Auth)
                                |
                                v
               [ Auth Middleware (req.user) ]
                                |
                                v
     [ Shared AI Rate Limiter (20 req/min per User) ]
                                |
          +---------------------+---------------------+
          |                                           |
          v                                           v
[ POST /interviews/:id/questions/generate ]    [ POST /questions/:questionId/answers ]
  - Verify interview ownership & status          - Verify question ownership & status
  - Resolve pending question (Idempotency)       - Verify current pending question
  - Redis Lock: `lock:question-gen:<id>`         - Redis Lock: `lock:answer-eval:<id>`
  - Reserve Daily/Monthly AI Quota               - Run Guardrail Prompt Injection Check
  - Call AIService.generateQuestion()            - Save Answer row
  - Validate with Zod & Retry once if invalid    - Reserve Daily/Monthly AI Quota
  - Upsert PromptVersion & Record AIUsage        - Call AIService.evaluateAnswer()
  - Save Question (`orderIndex`, `AI_GENERATED`) - Validate Evaluation JSON & Retry once
  - Release Lock -> Return 201/200               - Upsert PromptVersion & Record AIUsage
                                                 - Save Evaluation row & mark question ANSWERED
                                                 - Release Lock -> Return 201/200
```

---

## 2. Step 7: Question Generation

### Endpoint: `POST /api/interviews/:id/questions/generate`
* **Auth**: Required (`req.user.id`).
* **Route**: Mounted at `/api/interviews/:id/questions/generate`.
* **Middleware Order**: `authenticate` -> `aiRateLimiter` -> `QuestionController.generateQuestion`.

### Response Contract
* **201 Created** (when a new question is generated):
  ```json
  {
    "question": {
      "id": "uuid",
      "interviewId": "uuid",
      "questionText": "string",
      "topic": "string",
      "category": "string",
      "difficulty": "EASY | MEDIUM | HARD",
      "questionType": "conceptual | coding | behavioral | system-design | situational",
      "order": 1,
      "createdAt": "ISO timestamp"
    },
    "reused": false,
    "progress": { "current": 1, "total": 5 }
  }
  ```
* **200 OK** (Idempotency — when an unanswered pending question already exists for this interview):
  Same shape as above, with `reused: true`.

### Error Codes & Statuses
| Status | Error Code | Description |
|:---|:---|:---|
| `400` | `INVALID_INTERVIEW_ID` | `id` parameter is not a valid UUID |
| `401` | `UNAUTHORIZED` | Token is missing or invalid |
| `404` | `INTERVIEW_NOT_FOUND` | Interview does not exist or belongs to another user |
| `409` | `INTERVIEW_NOT_ACTIVE` | Interview status is not `IN_PROGRESS` |
| `409` | `QUESTION_LIMIT_REACHED` | Top-level questions count reached `interview.questionLimit` |
| `409` | `GENERATION_IN_PROGRESS` | Lock held for this interview; includes `Retry-After: 2` header |
| `429` | `RATE_LIMITED` | Exceeded 20 AI reqs/min; includes `Retry-After` header |
| `429` | `USAGE_CAP_EXCEEDED` | Daily or monthly cap exhausted; includes `scope` & `resetAt` |
| `502` | `AI_OUTPUT_INVALID` | AI returned invalid schema twice (after 1 retry) |
| `502` | `AI_UNAVAILABLE` | All AI providers failed (Gemini -> Groq -> OpenRouter) |
| `503` | `SERVICE_UNAVAILABLE` | Redis unreachable in fail-closed mode |

---

## 3. Step 8: Answer Evaluation

### Endpoint: `POST /api/questions/:questionId/answers`
* **Auth**: Required (`req.user.id`).
* **Route**: Mounted at `/api/questions/:questionId/answers`.
* **Body**: `{ "answerText": "..." }`
* **Middleware Order**: `authenticate` -> `aiRateLimiter` -> `AnswerController.submitAnswer`.

### Response Contract
* **201 Created** (first submission of answer):
  ```json
  {
    "answer": {
      "id": "uuid",
      "questionId": "uuid",
      "answerText": "string",
      "createdAt": "ISO timestamp"
    },
    "evaluation": {
      "id": "uuid",
      "score": 8,
      "accuracyScore": 9,
      "clarityScore": 8,
      "completenessScore": 7,
      "relevanceScore": 9,
      "communicationScore": 8,
      "strengths": ["string"],
      "weaknesses": ["string"],
      "missingConcepts": ["string"],
      "feedback": "string",
      "idealAnswer": "string",
      "createdAt": "ISO timestamp"
    },
    "reused": false,
    "guardrail": {
      "flagged": false
    }
  }
  ```
* **200 OK** (Idempotency — re-submitting an already answered question returns existing evaluation):
  Same shape with `reused: true, guardrail: { flagged: false }`.

### Error Codes & Statuses
| Status | Error Code | Description |
|:---|:---|:---|
| `400` | `INVALID_QUESTION_ID` | `questionId` is not a valid UUID |
| `400` | `VALIDATION_ERROR` | `answerText` fails length/whitespace rules (min 10, max 5000) |
| `401` | `UNAUTHORIZED` | Token missing or invalid |
| `404` | `QUESTION_NOT_FOUND` | Question not found or belongs to another user |
| `409` | `INTERVIEW_NOT_ACTIVE` | Interview status is not `IN_PROGRESS` |
| `409` | `QUESTION_NOT_PENDING` | Attempting to answer a non-pending question |
| `409` | `ANSWER_LOCKED` | Evaluation lock held; includes `Retry-After: 2` header |
| `422` | `ANSWER_REJECTED_GUARDRAIL` | `ANSWER_GUARDRAIL_POLICY=reject` and injection detected |
| `429` | `RATE_LIMITED` | Exceeded 20 AI reqs/min |
| `429` | `USAGE_CAP_EXCEEDED` | User daily/monthly AI quota exceeded |
| `502` | `AI_OUTPUT_INVALID` | Evaluation output invalid after 1 retry |
| `502` | `AI_UNAVAILABLE` | All AI providers failed |
| `503` | `SERVICE_UNAVAILABLE` | Redis unreachable |

---

## 4. Key Subsystems & Core Logic

### 1. Guardrail Prompt Injection Detection (`src/services/guardrail.service.ts`)
* Heuristic regex layer checking for grading override attempts:
  * "ignore/disregard the rubric/instructions/scoring"
  * "give me / this candidate a 10 / full / perfect score"
  * "you are now", "new instructions", "system:", "###instruction", "act as", "override grading"
* **Severity**:
  * `high`: 2+ distinct patterns match OR high-confidence co-occurrence match (e.g. "ignore" with "rubric"/"score").
  * `low`: 1 weaker pattern matches.
* **Security & Privacy Rule**: **Never logs raw text or matched substrings**. Only logs:
  `{ event: 'guardrail_flagged', source: 'answer', severity, matchCount, userId, questionId }`
* **Policy Config (`ANSWER_GUARDRAIL_POLICY`)**:
  * `flag` (default): Logs warning, carries `guardrail: { flagged: true }` in 201 response, grades normally.
  * `reject`: Logs warning, throws `422 ANSWER_REJECTED_GUARDRAIL`, creates 0 DB rows, consumes 0 AI quota.

### 2. Validation & Business Rules (`src/validators/`)
* **Answer Validation (`answer.validator.ts`)**:
  * `answerText`: string, trimmed, min 10, max 5000 characters. Rejects whitespace-only explicitly.
  * `questionId`: valid UUID.
* **Evaluation Validation (`evaluation.validator.ts`)**:
  * `score`, `accuracyScore`, `clarityScore`, `completenessScore`, `relevanceScore`, `communicationScore`: integers strictly between `0` and `10` (e.g. `150` rejected).
  * `strengths`, `weaknesses`, `missingConcepts`: array of strings, max 10 items each, each 1–200 characters.
  * `feedback`: trimmed string, 10–2000 characters.
  * `idealAnswer`: trimmed string, 10–2000 characters.

### 3. Rate Limiting & Lock Management
* **Single Shared AI Limiter (`src/middleware/rateLimit.middleware.ts`)**:
  * `aiRateLimiter` configured with `RateLimiterRedis` (`rl:ai`, 20 points / 60 seconds).
  * Both `/questions/generate` and `/questions/:questionId/answers` use the exact same middleware instance keyed on `req.user.id`.
* **Distributed Redis Lock (`src/utils/redisLock.ts`)**:
  * `acquireLock(key, ttl)` uses `SET key token EX ttl NX`.
  * `releaseLock(key, token)` uses Lua script compare-and-delete (only owner releases).

### 4. Quota & Usage Enforcement (`src/services/usage-limit.service.ts`)
* **Atomic conditional reservation** via Prisma `$executeRaw`:
  ```sql
  UPDATE "UsageLimit"
  SET "dailyUsed" = "dailyUsed" + 1, "monthlyUsed" = "monthlyUsed" + 1
  WHERE "userId" = $1
    AND "dailyUsed" < "dailyLimit" AND "monthlyUsed" < "monthlyLimit"
  ```
* Atomic refund via `refundUsage` on failed AI calls.
* Auto-rollover at UTC midnight (daily) and 1st of month (monthly).

### 5. AI Service Orchestration & Retries (`src/services/ai.service.ts`)
* Provider chain: Gemini -> Groq -> OpenRouter.
* Per-attempt timeout using `Promise.race` with `aiConfig.requestTimeoutMs` (default 20s).
* Returns `{ data, meta: { provider, model, latencyMs, fallbackCount } }`.
* Throws `AIServiceError` on total failure with attempts breakdown.
* **1-Time Retry Pattern**: If AI output fails Zod validation:
  1. Record `AIUsage` as `FAILURE` / `VALIDATION`.
  2. Call AI again with same reserved quota.
  3. If retry passes -> record `SUCCESS` and proceed.
  4. If retry fails -> record `FAILURE`, refund quota, throw `502 AI_OUTPUT_INVALID`.

---

## 5. Summary of Verification Test Suites

| Test Suite / Script | Command | Purpose |
|:---|:---|:---|
| **Unit Test** | `npx vitest run tests/unit/evaluation-retry.test.ts` | Unit test mocking AI returning score `150` on 1st call and `9` on retry call, asserting retry succeeds and only valid evaluation is saved. |
| **Step 7 E2E** | `npx ts-node src/scripts/verifyStep7.ts` | Tests Scenarios A–G for question generation (happy path, idempotency, concurrency lock, auth, usage cap, rate limit). |
| **Step 8 E2E** | `npx ts-node src/scripts/verifyStep8.ts` | Tests Scenarios A–G for answer evaluation (happy path, idempotency, guardrail flag, concurrency lock, auth, question-not-pending, usage cap, shared rate limit pool). |
| **Scenario H Manual** | `npx ts-node src/scripts/manualScenarioH.ts` | Tests `ANSWER_GUARDRAIL_POLICY=reject` returning `422 ANSWER_REJECTED_GUARDRAIL` with 0 rows created. |
| **TypeScript Build** | `npx tsc --noEmit` | Clean type compilation check across the entire project. |
