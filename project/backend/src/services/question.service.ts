import { prisma } from '../config/prisma';
import { AIService } from './ai.service';
import { AIServiceError } from '../errors/AIServiceError';
import { UsageLimitService, UsageCapExceededError } from './usage-limit.service';
import { PromptVersionService } from './prompt-version.service';
import { AIUsageService } from './ai-usage.service';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { limitsConfig } from '../config/limits.config';
import { generatedQuestionSchema } from '../validators/question.validator';
import { PROMPT_VERSIONS } from '../prompts/versions';
import { logger } from '../config/logger';
import {
  getPendingQuestion,
  getLastCompletedQuestion,
  countTopLevel,
  getQuestionDepth,
  QuestionState,
  QuestionNode,
} from './interview-state.service';
import { followUpConfig } from '../config/followup.config';
import { decideFollowUp } from './followup-policy.service';
import { detectInjection } from './guardrail.service';

export class AppError extends Error {
  statusCode: number;
  code: string;
  extra?: Record<string, any>;
  headers?: Record<string, string | number>;

  constructor(statusCode: number, code: string, message: string, extra?: Record<string, any>, headers?: Record<string, string | number>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
}

interface GenerateResult {
  question: {
    id: string;
    interviewId: string;
    questionText: string;
    topic: string | null;
    category: string | null;
    difficulty: string | null;
    questionType: string | null;
    order: number;
    parentQuestionId: string | null;
    isFollowUp: boolean;
    createdAt: Date;
  };
  reused: boolean;
  progress: { current: number; total: number; followUpsUsed: number };
}

function countFollowUps(questions: any[]): number {
  return questions.filter((q: any) => q.parentQuestionId !== null).length;
}

/**
 * Computes the 1-based position among top-level questions of this question's root.
 * A follow-up shares its parent's (root's) position among top-level questions.
 */
function getTopLevelPosition(question: any, allQuestions: any[]): number {
  const allMap = new Map<string, any>(allQuestions.map((q) => [q.id, q]));
  let current = question;
  let hops = 0;
  while (current.parentQuestionId !== null && hops < 100) {
    const parent = allMap.get(current.parentQuestionId);
    if (!parent) break;
    current = parent;
    hops++;
  }
  const rootId = current.id;

  const topLevels = allQuestions
    .filter((q) => q.parentQuestionId === null)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const idx = topLevels.findIndex((q) => q.id === rootId);
  return idx >= 0 ? idx + 1 : 1;
}

function mapQuestion(q: any): GenerateResult['question'] {
  return {
    id: q.id,
    interviewId: q.interviewId,
    questionText: q.questionText,
    topic: q.topic,
    category: q.category,
    difficulty: q.difficulty,
    questionType: q.questionType,
    order: q.orderIndex,
    parentQuestionId: q.parentQuestionId ?? null,
    isFollowUp: q.parentQuestionId !== null,
    createdAt: q.createdAt,
  };
}

/** Shared helper: call AI generateQuestion with the retry-once-on-invalid pattern */
async function callGenerateQuestionWithRetry(
  interview: any,
  previousQuestions: string[],
  userId: string,
): Promise<{ validatedData: any; meta: any }> {
  const aiResult = await AIService.generateQuestion({
    role: interview.role,
    experienceLevel: interview.experienceLevel,
    interviewType: interview.interviewType,
    difficulty: interview.difficulty,
    previousQuestions,
  });
  const meta = aiResult.meta;

  const promptVersionId = await PromptVersionService.getOrCreatePromptVersion(
    'question-generation',
    PROMPT_VERSIONS.questionGeneration.split('@')[1] ? `v${PROMPT_VERSIONS.questionGeneration.split('@')[1]}` : 'v1',
    meta.provider,
    meta.model,
  ).catch(() => null);

  const parseResult = generatedQuestionSchema.safeParse(aiResult.data);
  if (!parseResult.success) {
    await AIUsageService.recordAIUsage({
      userId,
      provider: meta.provider,
      model: meta.model,
      requestType: 'QUESTION_GENERATION',
      promptVersionId,
      latencyMs: meta.latencyMs,
      cacheHit: false,
      retryCount: meta.fallbackCount,
      status: 'FAILURE',
      failureCategory: 'VALIDATION',
    });

    const retryResult = await AIService.generateQuestion({
      role: interview.role,
      experienceLevel: interview.experienceLevel,
      interviewType: interview.interviewType,
      difficulty: interview.difficulty,
      previousQuestions,
    });
    const retryMeta = retryResult.meta;
    const retryParseResult = generatedQuestionSchema.safeParse(retryResult.data);

    const retryPromptVersionId = await PromptVersionService.getOrCreatePromptVersion(
      'question-generation',
      PROMPT_VERSIONS.questionGeneration.split('@')[1] ? `v${PROMPT_VERSIONS.questionGeneration.split('@')[1]}` : 'v1',
      retryMeta.provider,
      retryMeta.model,
    ).catch(() => null);

    if (!retryParseResult.success) {
      await AIUsageService.recordAIUsage({
        userId,
        provider: retryMeta.provider,
        model: retryMeta.model,
        requestType: 'QUESTION_GENERATION',
        promptVersionId: retryPromptVersionId,
        latencyMs: retryMeta.latencyMs,
        cacheHit: false,
        retryCount: retryMeta.fallbackCount,
        status: 'FAILURE',
        failureCategory: 'VALIDATION',
      });
      await UsageLimitService.refundUsage(userId);
      throw new AppError(502, 'AI_OUTPUT_INVALID', 'AI returned invalid output after retry');
    }

    await AIUsageService.recordAIUsage({
      userId,
      provider: retryMeta.provider,
      model: retryMeta.model,
      requestType: 'QUESTION_GENERATION',
      promptVersionId: retryPromptVersionId,
      latencyMs: retryMeta.latencyMs,
      cacheHit: false,
      retryCount: retryMeta.fallbackCount,
      status: 'SUCCESS',
      failureCategory: null,
    });
    return { validatedData: retryParseResult.data, meta: retryMeta };
  } else {
    await AIUsageService.recordAIUsage({
      userId,
      provider: meta.provider,
      model: meta.model,
      requestType: 'QUESTION_GENERATION',
      promptVersionId,
      latencyMs: meta.latencyMs,
      cacheHit: false,
      retryCount: meta.fallbackCount,
      status: 'SUCCESS',
      failureCategory: null,
    });
    return { validatedData: parseResult.data, meta };
  }
}

export class QuestionService {
  static async generateQuestion(interviewId: string, userId: string): Promise<GenerateResult> {
    let interview: any;
    try {
      interview = await prisma.interview.findUnique({
        where: { id: interviewId },
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            include: {
              answers: {
                include: {
                  evaluation: {
                    select: {
                      id: true,
                      score: true,
                      completenessScore: true,
                      relevanceScore: true,
                      missingConcepts: true,
                    },
                  },
                },
                take: 1,
              },
            },
          },
        },
      });
    } catch {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    }

    if (!interview || interview.userId !== userId) {
      throw new AppError(404, 'INTERVIEW_NOT_FOUND', 'Interview not found');
    }

    if (interview.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'INTERVIEW_NOT_ACTIVE', 'Interview is not in progress');
    }

    let lockToken: string | null = null;
    const lockKey = `lock:question-gen:${interviewId}`;

    try {
      lockToken = await acquireLock(lockKey, limitsConfig.generationLockTtlSeconds);
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
    }

    if (!lockToken) {
      throw new AppError(
        409,
        'GENERATION_IN_PROGRESS',
        'Question generation already in progress for this interview',
        undefined,
        { 'Retry-After': 2 }
      );
    }

    let reused = false;
    let resultQuestion: any = null;
    let mode: 'follow-up' | 'top-level' = 'top-level';

    try {
      const rawQuestions = interview.questions as any[];

      // Map raw DB rows to QuestionState shape
      const allQuestions: QuestionState[] = rawQuestions.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        parentQuestionId: q.parentQuestionId,
        answer: q.answers[0]
          ? { id: q.answers[0].id, evaluation: q.answers[0].evaluation ?? null }
          : null,
      }));

      const allQuestionsMap = new Map<string, any>(rawQuestions.map((q) => [q.id, q]));
      const followUpsUsed = countFollowUps(rawQuestions);

      // ── Step 1: Idempotency — return any pending (incomplete) question ──────
      const pendingQuestion = getPendingQuestion(allQuestions);
      if (pendingQuestion) {
        const rawPending = allQuestionsMap.get(pendingQuestion.id)!;
        reused = true;
        resultQuestion = rawPending;
        mode = rawPending.parentQuestionId !== null ? 'follow-up' : 'top-level';
        logger.info({ interviewId, userId, mode, reused: true, provider: null, latencyMs: 0 }, 'Question generated');
        const currentProgress = getTopLevelPosition(rawPending, rawQuestions);
        return {
          question: mapQuestion(resultQuestion),
          reused: true,
          progress: { current: currentProgress, total: interview.questionLimit, followUpsUsed },
        };
      }

      // ── Step 2: Follow-up decision ──────────────────────────────────────────
      const lastCompleted = getLastCompletedQuestion(allQuestions);

      // Build questionsById map for depth calculation
      const questionsById = new Map<string, QuestionNode>(
        rawQuestions.map((q) => [q.id, { id: q.id, parentQuestionId: q.parentQuestionId }])
      );

      let doFollowUp = false;
      let followUpParentRaw: any = null;
      let followUpDecisionReason: string = 'N/A';

      if (lastCompleted && followUpConfig.enabled) {
        const rawLast = allQuestionsMap.get(lastCompleted.id)!;
        // It's a follow-up candidate only if no question already has parentQuestionId === last.id
        const alreadyHasFollowUp = rawQuestions.some((q: any) => q.parentQuestionId === rawLast.id);

        if (!alreadyHasFollowUp) {
          const evalRow = rawLast.answers[0]?.evaluation;
          if (evalRow) {
            // Check guardrail on the answer text
            const answerText: string = rawLast.answers[0]?.answerText ?? '';
            const guardrailResult = detectInjection(answerText);
            let decision: { followUp: boolean; reason: string };

            if (guardrailResult.severity === 'high') {
              decision = { followUp: false, reason: 'GUARDRAIL' };
            } else {
              const depth = getQuestionDepth(
                { id: rawLast.id, parentQuestionId: rawLast.parentQuestionId },
                questionsById
              );
              const missingConcepts = Array.isArray(evalRow.missingConcepts) ? evalRow.missingConcepts : [];
              decision = decideFollowUp(
                {
                  evaluation: {
                    score: evalRow.score,
                    completenessScore: evalRow.completenessScore,
                    relevanceScore: evalRow.relevanceScore,
                    missingConcepts,
                  },
                  depth,
                  followUpsUsed,
                },
                followUpConfig
              );
            }

            logger.info({
              event: 'followup_decision',
              interviewId,
              parentQuestionId: rawLast.id,
              followUp: decision.followUp,
              reason: decision.reason,
            }, '');

            followUpDecisionReason = decision.reason;
            if (decision.followUp) {
              doFollowUp = true;
              followUpParentRaw = rawLast;
            }
          }
        }
      }

      // ── Step 3: Follow-Up Mode ───────────────────────────────────────────────
      if (doFollowUp && followUpParentRaw) {
        mode = 'follow-up';

        // Reserve usage (no questionLimit check for follow-ups)
        await UsageLimitService.getOrCreateUsageLimit(userId);
        try {
          await UsageLimitService.reserveUsage(userId);
        } catch (err) {
          if (err instanceof UsageCapExceededError) {
            throw new AppError(429, 'USAGE_CAP_EXCEEDED', err.message, {
              scope: err.scope,
              resetAt: err.resetAt,
            });
          }
          throw err;
        }

        const parentEval = followUpParentRaw.answers[0]?.evaluation;
        const missingConcepts = Array.isArray(parentEval?.missingConcepts)
          ? parentEval.missingConcepts as string[]
          : [];
        const focusConcept = missingConcepts[0] ?? null;
        const previousQuestions = rawQuestions.map((q: any) => q.questionText);
        const parentDifficulty: string = followUpParentRaw.difficulty ?? interview.difficulty;

        // ── Step 3d: Call AI for follow-up ─────────────────────────────────
        let followUpValidatedData: any = null;
        let followUpMeta: any = null;
        let degraded = false;

        try {
          const fuResult = await AIService.generateFollowUp({
            originalQuestion: followUpParentRaw.questionText,
            answerText: followUpParentRaw.answers[0]?.answerText ?? '',
            evaluation: {
              score: parentEval.score,
              accuracyScore: parentEval.accuracyScore ?? 0,
              clarityScore: parentEval.clarityScore ?? 0,
              completenessScore: parentEval.completenessScore ?? 0,
              relevanceScore: parentEval.relevanceScore ?? 0,
              communicationScore: parentEval.communicationScore ?? 0,
              strengths: parentEval.strengths ?? [],
              weaknesses: parentEval.weaknesses ?? [],
              missingConcepts,
              feedback: parentEval.feedback ?? '',
              idealAnswer: parentEval.idealAnswer ?? '',
            },
            role: interview.role,
            experienceLevel: interview.experienceLevel,
            difficulty: parentDifficulty,
            focusConcept,
            previousQuestions,
          });
          followUpMeta = fuResult.meta;

          const fuPromptVersionId = await PromptVersionService.getOrCreatePromptVersion(
            'follow-up',
            PROMPT_VERSIONS.followUp,
            followUpMeta.provider,
            followUpMeta.model,
          ).catch(() => null);

          const fuExistingTexts = rawQuestions.map((q: any) => q.questionText.trim().toLowerCase().replace(/\s+/g, ' '));
          const fuParseResult = generatedQuestionSchema.safeParse(fuResult.data);

          if (!fuParseResult.success || fuExistingTexts.includes(
            (fuResult.data as any)?.questionText?.trim().toLowerCase().replace(/\s+/g, ' ')
          )) {
            // First attempt invalid — record FAILURE, retry once
            await AIUsageService.recordAIUsage({
              userId,
              provider: followUpMeta.provider,
              model: followUpMeta.model,
              requestType: 'FOLLOW_UP',
              promptVersionId: fuPromptVersionId,
              latencyMs: followUpMeta.latencyMs,
              cacheHit: false,
              retryCount: followUpMeta.fallbackCount,
              status: 'FAILURE',
              failureCategory: 'VALIDATION',
            });

            const retryFu = await AIService.generateFollowUp({
              originalQuestion: followUpParentRaw.questionText,
              answerText: followUpParentRaw.answers[0]?.answerText ?? '',
              evaluation: {
                score: parentEval.score,
                accuracyScore: parentEval.accuracyScore ?? 0,
                clarityScore: parentEval.clarityScore ?? 0,
                completenessScore: parentEval.completenessScore ?? 0,
                relevanceScore: parentEval.relevanceScore ?? 0,
                communicationScore: parentEval.communicationScore ?? 0,
                strengths: parentEval.strengths ?? [],
                weaknesses: parentEval.weaknesses ?? [],
                missingConcepts,
                feedback: parentEval.feedback ?? '',
                idealAnswer: parentEval.idealAnswer ?? '',
              },
              role: interview.role,
              experienceLevel: interview.experienceLevel,
              difficulty: parentDifficulty,
              focusConcept,
              previousQuestions,
            });
            const retryFuMeta = retryFu.meta;
            const retryFuParse = generatedQuestionSchema.safeParse(retryFu.data);

            const retryFuPromptVersionId = await PromptVersionService.getOrCreatePromptVersion(
              'follow-up',
              PROMPT_VERSIONS.followUp,
              retryFuMeta.provider,
              retryFuMeta.model,
            ).catch(() => null);

            const retryText = (retryFu.data as any)?.questionText?.trim().toLowerCase().replace(/\s+/g, ' ');
            if (!retryFuParse.success || fuExistingTexts.includes(retryText)) {
              // Both attempts invalid — FAIL OPEN: refund and fall through to top-level
              await AIUsageService.recordAIUsage({
                userId,
                provider: retryFuMeta.provider,
                model: retryFuMeta.model,
                requestType: 'FOLLOW_UP',
                promptVersionId: retryFuPromptVersionId,
                latencyMs: retryFuMeta.latencyMs,
                cacheHit: false,
                retryCount: retryFuMeta.fallbackCount,
                status: 'FAILURE',
                failureCategory: 'VALIDATION',
              });
              await UsageLimitService.refundUsage(userId);
              logger.info({ event: 'followup_degraded', interviewId, userId }, '');
              degraded = true;
            } else {
              await AIUsageService.recordAIUsage({
                userId,
                provider: retryFuMeta.provider,
                model: retryFuMeta.model,
                requestType: 'FOLLOW_UP',
                promptVersionId: retryFuPromptVersionId,
                latencyMs: retryFuMeta.latencyMs,
                cacheHit: false,
                retryCount: retryFuMeta.fallbackCount,
                status: 'SUCCESS',
                failureCategory: null,
              });
              followUpValidatedData = retryFuParse.data;
              followUpMeta = retryFuMeta;
            }
          } else {
            // First attempt valid
            await AIUsageService.recordAIUsage({
              userId,
              provider: followUpMeta.provider,
              model: followUpMeta.model,
              requestType: 'FOLLOW_UP',
              promptVersionId: fuPromptVersionId,
              latencyMs: followUpMeta.latencyMs,
              cacheHit: false,
              retryCount: followUpMeta.fallbackCount,
              status: 'SUCCESS',
              failureCategory: null,
            });
            followUpValidatedData = fuParseResult.data;
          }
        } catch (err: any) {
          if (err instanceof AppError) throw err;
          if (err instanceof AIServiceError) {
            // FAIL CLOSED: record FAILURE, refund, throw 502
            const lastAttempt = err.attempts[err.attempts.length - 1];
            await AIUsageService.recordAIUsage({
              userId,
              provider: lastAttempt?.provider ?? 'unknown',
              model: lastAttempt?.model ?? 'unknown',
              requestType: 'FOLLOW_UP',
              promptVersionId: null,
              latencyMs: err.latencyMs,
              cacheHit: false,
              retryCount: err.attempts.length - 1,
              status: 'FAILURE',
              failureCategory: 'ALL_PROVIDERS_FAILED',
            });
            await UsageLimitService.refundUsage(userId);
            throw new AppError(502, 'AI_UNAVAILABLE', 'All AI providers failed');
          }
          throw err;
        }

        // Save follow-up question if not degraded
        if (!degraded && followUpValidatedData) {
          const nextOrder = rawQuestions.length > 0
            ? Math.max(...rawQuestions.map((q: any) => q.orderIndex)) + 1
            : 1;

          try {
            resultQuestion = await prisma.question.create({
              data: {
                interviewId,
                questionText: followUpValidatedData.questionText,
                topic: followUpValidatedData.topic,
                category: followUpValidatedData.category,
                // Server-side enforced values per spec:
                difficulty: parentDifficulty,
                questionType: 'follow-up',
                orderIndex: nextOrder,
                source: 'AI_FOLLOW_UP',
                parentQuestionId: followUpParentRaw.id,
                status: 'PENDING',
              },
            });
          } catch (err: any) {
            if (err?.code === 'P2002') {
              // Constraint violation — refetch pending and return reused
              const refetched = await prisma.interview.findUnique({
                where: { id: interviewId },
                include: {
                  questions: {
                    orderBy: { orderIndex: 'asc' },
                    include: {
                      answers: {
                        include: { evaluation: { select: { id: true } } },
                        take: 1,
                      },
                    },
                  },
                },
              });
              const rfStates: QuestionState[] = (refetched?.questions ?? []).map((q: any) => ({
                id: q.id,
                orderIndex: q.orderIndex,
                parentQuestionId: q.parentQuestionId,
                answer: q.answers[0]
                  ? { id: q.answers[0].id, evaluation: q.answers[0].evaluation ?? null }
                  : null,
              }));
              const rfPending = getPendingQuestion(rfStates);
              const rfRaw = rfPending ? refetched?.questions?.find((q: any) => q.id === rfPending.id) : null;
              if (rfRaw) {
                reused = true;
                resultQuestion = rfRaw;
                logger.info({ interviewId, userId, mode, reused: true, provider: followUpMeta?.provider, latencyMs: followUpMeta?.latencyMs }, 'Question generated');
                const allRfList = refetched?.questions ?? [];
                const rootIdx = getTopLevelPosition(rfRaw, allRfList);
                return {
                  question: mapQuestion(resultQuestion),
                  reused: true,
                  progress: { current: rootIdx, total: interview.questionLimit, followUpsUsed },
                };
              } else {
                throw new AppError(409, 'QUESTION_LIMIT_REACHED', 'Question limit reached');
              }
            }
            throw err;
          }

          logger.info({
            interviewId,
            userId,
            mode: 'follow-up',
            reused: false,
            provider: followUpMeta?.provider,
            latencyMs: followUpMeta?.latencyMs,
          }, 'Question generated');

          const allQuestionsWithNew = [...rawQuestions, resultQuestion];
          const rootIdx = getTopLevelPosition(resultQuestion, allQuestionsWithNew);
          return {
            question: mapQuestion(resultQuestion),
            reused: false,
            progress: {
              current: rootIdx,
              total: interview.questionLimit,
              followUpsUsed: followUpsUsed + 1,
            },
          };
        }

        // Degraded — fall through to top-level flow below
        mode = 'top-level';
        doFollowUp = false;
      }

      // ── Step 4: Top-Level Generation ────────────────────────────────────────
      mode = 'top-level';

      const topLevelCount = countTopLevel(allQuestions);
      if (topLevelCount >= interview.questionLimit) {
        throw new AppError(409, 'QUESTION_LIMIT_REACHED', 'Question limit reached for this interview');
      }

      await UsageLimitService.getOrCreateUsageLimit(userId);
      try {
        await UsageLimitService.reserveUsage(userId);
      } catch (err) {
        if (err instanceof UsageCapExceededError) {
          throw new AppError(429, 'USAGE_CAP_EXCEEDED', err.message, {
            scope: err.scope,
            resetAt: err.resetAt,
          });
        }
        throw err;
      }

      const previousQuestions = rawQuestions.map((q: any) => q.questionText);
      let validatedData: any;
      let meta: any;

      try {
        const result = await callGenerateQuestionWithRetry(interview, previousQuestions, userId);
        validatedData = result.validatedData;
        meta = result.meta;
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        if (err instanceof AIServiceError) {
          const lastAttempt = err.attempts[err.attempts.length - 1];
          await AIUsageService.recordAIUsage({
            userId,
            provider: lastAttempt?.provider ?? 'unknown',
            model: lastAttempt?.model ?? 'unknown',
            requestType: 'QUESTION_GENERATION',
            promptVersionId: null,
            latencyMs: err.latencyMs,
            cacheHit: false,
            retryCount: err.attempts.length - 1,
            status: 'FAILURE',
            failureCategory: 'ALL_PROVIDERS_FAILED',
          });
          await UsageLimitService.refundUsage(userId);
          throw new AppError(502, 'AI_UNAVAILABLE', 'All AI providers failed');
        }
        throw err;
      }

      const existingTexts = rawQuestions.map((q: any) => q.questionText.trim().toLowerCase().replace(/\s+/g, ' '));
      const newText = validatedData.questionText.trim().toLowerCase().replace(/\s+/g, ' ');
      if (existingTexts.includes(newText)) {
        await UsageLimitService.refundUsage(userId);
        throw new AppError(502, 'AI_OUTPUT_INVALID', 'AI generated a duplicate question');
      }

      // nextOrder is based on highest existing order across all questions in interview
      const nextOrder = rawQuestions.length > 0
        ? Math.max(...rawQuestions.map((q: any) => q.orderIndex)) + 1
        : 1;

      try {
        resultQuestion = await prisma.question.create({
          data: {
            interviewId,
            questionText: validatedData.questionText,
            topic: validatedData.topic,
            category: validatedData.category,
            difficulty: validatedData.difficulty,
            questionType: validatedData.questionType,
            orderIndex: nextOrder,
            source: 'AI_GENERATED',
            parentQuestionId: null,
            status: 'PENDING',
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const refetched = await prisma.interview.findUnique({
            where: { id: interviewId },
            include: {
              questions: {
                orderBy: { orderIndex: 'asc' },
                include: {
                  answers: {
                    include: { evaluation: { select: { id: true } } },
                    take: 1,
                  },
                },
              },
            },
          });
          const refetchedStates: QuestionState[] = (refetched?.questions ?? []).map((q: any) => ({
            id: q.id,
            orderIndex: q.orderIndex,
            parentQuestionId: q.parentQuestionId,
            answer: q.answers[0]
              ? { id: q.answers[0].id, evaluation: q.answers[0].evaluation ?? null }
              : null,
          }));
          const racePending = getPendingQuestion(refetchedStates);
          const rawRacePending = racePending
            ? refetched?.questions?.find((q: any) => q.id === racePending.id)
            : null;
          if (rawRacePending) {
            reused = true;
            resultQuestion = rawRacePending;
            const allRfList = refetched?.questions ?? [];
            const rootIdx = getTopLevelPosition(rawRacePending, allRfList);
            return {
              question: mapQuestion(resultQuestion),
              reused: true,
              progress: { current: rootIdx, total: interview.questionLimit, followUpsUsed },
            };
          } else {
            throw new AppError(409, 'QUESTION_LIMIT_REACHED', 'Question limit reached');
          }
        } else {
          throw err;
        }
      }

      logger.info({
        interviewId,
        userId,
        mode: 'top-level',
        reused,
        provider: meta?.provider,
        latencyMs: meta?.latencyMs,
      }, 'Question generated');

      const finalFollowUpsUsed = countFollowUps(
        reused ? rawQuestions : [...rawQuestions, resultQuestion]
      );

      const allQuestionsWithNew = reused ? rawQuestions : [...rawQuestions, resultQuestion];
      const rootIdx = getTopLevelPosition(resultQuestion, allQuestionsWithNew);

      return {
        question: mapQuestion(resultQuestion),
        reused,
        progress: {
          current: rootIdx,
          total: interview.questionLimit,
          followUpsUsed: finalFollowUpsUsed,
        },
      };

    } finally {
      if (lockToken) {
        try {
          await releaseLock(lockKey, lockToken);
        } catch (err) {
          logger.error({ err }, 'Failed to release Redis lock');
        }
      }
    }
  }
}
