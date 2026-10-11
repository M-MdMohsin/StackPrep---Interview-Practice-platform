import { prisma } from '../config/prisma';
import { AIService } from './ai.service';
import { AIServiceError } from '../errors/AIServiceError';
import { UsageLimitService, UsageCapExceededError } from './usage-limit.service';
import { PromptVersionService } from './prompt-version.service';
import { AIUsageService } from './ai-usage.service';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { limitsConfig } from '../config/limits.config';
import { guardrailConfig } from '../config/guardrail.config';
import { detectInjection } from './guardrail.service';
import { answerBodySchema, paramsSchema } from '../validators/answer.validator';
import { evaluationSchema } from '../validators/evaluation.validator';
import { PROMPT_VERSIONS } from '../prompts/versions';
import { logger } from '../config/logger';
import { AppError } from './question.service';
import { getPendingQuestion, QuestionState } from './interview-state.service';

export interface SubmitAnswerResult {
  answer: {
    id: string;
    questionId: string;
    answerText: string;
    createdAt: Date;
  };
  evaluation: {
    id: string;
    score: number;
    accuracyScore: number | null;
    clarityScore: number | null;
    completenessScore: number | null;
    relevanceScore: number | null;
    communicationScore: number | null;
    strengths: any;
    weaknesses: any;
    missingConcepts: any;
    feedback: string;
    idealAnswer: string | null;
    createdAt: Date;
  };
  reused: boolean;
  guardrail: {
    flagged: boolean;
  };
}

function mapEvaluation(ev: any): SubmitAnswerResult['evaluation'] {
  return {
    id: ev.id,
    score: ev.score,
    accuracyScore: ev.accuracyScore,
    clarityScore: ev.clarityScore,
    completenessScore: ev.completenessScore,
    relevanceScore: ev.relevanceScore,
    communicationScore: ev.communicationScore,
    strengths: ev.strengths,
    weaknesses: ev.weaknesses,
    missingConcepts: ev.missingConcepts,
    feedback: ev.feedback,
    idealAnswer: ev.idealAnswer,
    createdAt: ev.createdAt,
  };
}

export class AnswerService {
  static async submitAnswer(
    questionId: string,
    userId: string,
    body: unknown
  ): Promise<SubmitAnswerResult> {
    // Validate questionId format
    const paramValidation = paramsSchema.safeParse({ questionId });
    if (!paramValidation.success) {
      throw new AppError(400, 'INVALID_QUESTION_ID', 'Invalid question ID format');
    }

    // 1. Load question with interview (ALL questions, incl. follow-ups) and existing answers
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: {
        interview: {
          include: {
            questions: {
              orderBy: { orderIndex: 'asc' },
              include: {
                answers: {
                  include: {
                    evaluation: { select: { id: true } },
                  },
                  take: 1,
                },
              },
            },
          },
        },
        answers: {
          include: {
            evaluation: true,
          },
          take: 1,
        },
      },
    });

    if (!question || question.interview.userId !== userId) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found');
    }

    if (question.interview.status !== 'IN_PROGRESS') {
      throw new AppError(409, 'INTERVIEW_NOT_ACTIVE', 'Interview is not in progress');
    }

    // 2. Compute the pending question using shared definition (top-level AND follow-ups)
    const allQuestions: QuestionState[] = (question.interview.questions as any[]).map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      parentQuestionId: q.parentQuestionId,
      answer: q.answers[0]
        ? { id: q.answers[0].id, evaluation: q.answers[0].evaluation ?? null }
        : null,
    }));

    const pendingQuestion = getPendingQuestion(allQuestions);

    const existingAnswer = (question.answers as any[])[0] ?? null;
    const isComplete = existingAnswer !== null && existingAnswer.evaluation !== null;

    if (isComplete) {
      // Idempotent: question fully evaluated — return it regardless of pending position
      logger.info(
        { questionId, userId, reused: true, guardrailFlagged: false, provider: null, latencyMs: 0 },
        'Returning existing answer evaluation'
      );
      return {
        answer: {
          id: existingAnswer.id,
          questionId: existingAnswer.questionId,
          answerText: existingAnswer.answerText,
          createdAt: existingAnswer.createdAt,
        },
        evaluation: mapEvaluation(existingAnswer.evaluation),
        reused: true,
        guardrail: { flagged: false },
      };
    }

    // 3. Not complete — check if this question is the pending question
    if (!pendingQuestion || question.id !== pendingQuestion.id) {
      throw new AppError(409, 'QUESTION_NOT_PENDING', 'This question is not the current pending question');
    }

    // 4. Acquire Redis lock
    let lockToken: string | null = null;
    const lockKey = `lock:answer-eval:${questionId}`;

    try {
      lockToken = await acquireLock(lockKey, limitsConfig.generationLockTtlSeconds);
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
    }

    if (!lockToken) {
      throw new AppError(
        409,
        'ANSWER_LOCKED',
        'Answer evaluation already in progress for this question',
        undefined,
        { 'Retry-After': 2 }
      );
    }

    try {
      // 5a. Re-check inside lock
      const lockedQuestion = await prisma.question.findUnique({
        where: { id: questionId },
        include: {
          answers: {
            include: {
              evaluation: true,
            },
          },
        },
      });

      const currentAnswer = lockedQuestion?.answers[0];
      if (currentAnswer && currentAnswer.evaluation) {
        logger.info(
          { questionId, userId, reused: true, guardrailFlagged: false, provider: null, latencyMs: 0 },
          'Returning existing answer evaluation inside lock'
        );
        return {
          answer: {
            id: currentAnswer.id,
            questionId: currentAnswer.questionId,
            answerText: currentAnswer.answerText,
            createdAt: currentAnswer.createdAt,
          },
          evaluation: mapEvaluation(currentAnswer.evaluation),
          reused: true,
          guardrail: { flagged: false },
        };
      }

      // 5b. Validate answerText
      const bodyValidation = answerBodySchema.safeParse(body);
      if (!bodyValidation.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          bodyValidation.error.issues[0]?.message || 'Validation failed for answer text',
          { details: bodyValidation.error.format() }
        );
      }
      const validatedAnswerText = bodyValidation.data.answerText;

      let savedAnswer: any;
      let guardrailFlagged = false;

      if (currentAnswer) {
        // Resume path: Answer exists without evaluation.
        // REUSE existing Answer row: never create a second one, never overwrite stored answerText.
        savedAnswer = currentAnswer;
        const storedGuardrail = detectInjection(savedAnswer.answerText);
        guardrailFlagged = storedGuardrail.flagged;
        if (guardrailFlagged) {
          logger.warn(
            {
              event: 'guardrail_flagged',
              source: 'answer',
              severity: storedGuardrail.severity,
              matchCount: storedGuardrail.matchCount,
              userId,
              questionId,
            },
            'Guardrail flagged stored answer text on resume'
          );
        }
      } else {
        // New Answer path: run injection check with reject policy enforcement
        const guardrailResult = detectInjection(validatedAnswerText);
        guardrailFlagged = guardrailResult.flagged;

        if (guardrailFlagged && guardrailConfig.policy === 'reject') {
          logger.warn(
            {
              event: 'guardrail_flagged',
              source: 'answer',
              severity: guardrailResult.severity,
              matchCount: guardrailResult.matchCount,
              userId,
              questionId,
            },
            'Guardrail rejected injection attempt'
          );
          throw new AppError(
            422,
            'ANSWER_REJECTED_GUARDRAIL',
            'Answer rejected by safety guardrail policy'
          );
        }

        if (guardrailFlagged) {
          logger.warn(
            {
              event: 'guardrail_flagged',
              source: 'answer',
              severity: guardrailResult.severity,
              matchCount: guardrailResult.matchCount,
              userId,
              questionId,
            },
            'Guardrail flagged potential injection attempt'
          );
        }

        savedAnswer = await prisma.answer.create({
          data: {
            questionId,
            answerText: validatedAnswerText,
          },
          include: {
            evaluation: true,
          },
        });
      }

      // 5e. Reserve usage
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

      // 5f. Call AI Service
      const evalParams = {
        questionText: question.questionText,
        answerText: savedAnswer.answerText,
        role: question.role || question.interview.role,
        difficulty: question.difficulty || question.interview.difficulty,
      };

      let aiResult: any;
      let meta: any;
      let evaluationData: any;

      try {
        aiResult = await AIService.evaluateAnswer(evalParams);
        meta = aiResult.meta;

        const promptVersionId = await PromptVersionService.getOrCreatePromptVersion(
          'evaluation',
          PROMPT_VERSIONS.evaluation,
          meta.provider,
          meta.model
        ).catch(() => null);

        // 5h. Validate AI evaluation output
        const parseResult = evaluationSchema.safeParse(aiResult.data);
        if (!parseResult.success) {
          // Record failure & retry once
          await AIUsageService.recordAIUsage({
            userId,
            provider: meta.provider,
            model: meta.model,
            requestType: 'EVALUATION',
            promptVersionId,
            latencyMs: meta.latencyMs,
            cacheHit: false,
            retryCount: meta.fallbackCount,
            status: 'FAILURE',
            failureCategory: 'VALIDATION',
          });

          const retryResult = await AIService.evaluateAnswer(evalParams);
          const retryMeta = retryResult.meta;
          const retryParse = evaluationSchema.safeParse(retryResult.data);

          const retryPromptVersionId = await PromptVersionService.getOrCreatePromptVersion(
            'evaluation',
            PROMPT_VERSIONS.evaluation,
            retryMeta.provider,
            retryMeta.model
          ).catch(() => null);

          if (!retryParse.success) {
            await AIUsageService.recordAIUsage({
              userId,
              provider: retryMeta.provider,
              model: retryMeta.model,
              requestType: 'EVALUATION',
              promptVersionId: retryPromptVersionId,
              latencyMs: retryMeta.latencyMs,
              cacheHit: false,
              retryCount: retryMeta.fallbackCount,
              status: 'FAILURE',
              failureCategory: 'VALIDATION',
            });
            await UsageLimitService.refundUsage(userId);
            throw new AppError(502, 'AI_OUTPUT_INVALID', 'AI returned invalid evaluation output after retry');
          }

          await AIUsageService.recordAIUsage({
            userId,
            provider: retryMeta.provider,
            model: retryMeta.model,
            requestType: 'EVALUATION',
            promptVersionId: retryPromptVersionId,
            latencyMs: retryMeta.latencyMs,
            cacheHit: false,
            retryCount: retryMeta.fallbackCount,
            status: 'SUCCESS',
            failureCategory: null,
          });

          evaluationData = retryParse.data;
          meta = retryMeta;
        } else {
          await AIUsageService.recordAIUsage({
            userId,
            provider: meta.provider,
            model: meta.model,
            requestType: 'EVALUATION',
            promptVersionId,
            latencyMs: meta.latencyMs,
            cacheHit: false,
            retryCount: meta.fallbackCount,
            status: 'SUCCESS',
            failureCategory: null,
          });

          evaluationData = parseResult.data;
        }
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        if (err instanceof AIServiceError) {
          const lastAttempt = err.attempts[err.attempts.length - 1];
          await AIUsageService.recordAIUsage({
            userId,
            provider: lastAttempt?.provider ?? 'unknown',
            model: lastAttempt?.model ?? 'unknown',
            requestType: 'EVALUATION',
            promptVersionId: null,
            latencyMs: err.latencyMs,
            cacheHit: false,
            retryCount: Math.max(0, err.attempts.length - 1),
            status: 'FAILURE',
            failureCategory: 'ALL_PROVIDERS_FAILED',
          });
          await UsageLimitService.refundUsage(userId);
          throw new AppError(502, 'AI_UNAVAILABLE', 'All AI providers failed');
        }
        throw err;
      }

      // 5j. Save Evaluation row
      const promptVersionId = await PromptVersionService.getOrCreatePromptVersion(
        'evaluation',
        PROMPT_VERSIONS.evaluation,
        meta.provider,
        meta.model
      ).catch(() => null);

      const evaluation = await prisma.evaluation.create({
        data: {
          answerId: savedAnswer.id,
          promptVersionId,
          score: evaluationData.score,
          accuracyScore: evaluationData.accuracyScore,
          clarityScore: evaluationData.clarityScore,
          completenessScore: evaluationData.completenessScore,
          relevanceScore: evaluationData.relevanceScore,
          communicationScore: evaluationData.communicationScore,
          strengths: evaluationData.strengths,
          weaknesses: evaluationData.weaknesses,
          missingConcepts: evaluationData.missingConcepts,
          feedback: evaluationData.feedback,
          idealAnswer: evaluationData.idealAnswer,
          rawEvaluation: evaluationData,
        },
      });

      // Update question status to ANSWERED
      await prisma.question
        .update({
          where: { id: questionId },
          data: { status: 'ANSWERED' },
        })
        .catch(() => {});

      logger.info(
        {
          questionId,
          userId,
          reused: false,
          guardrailFlagged,
          provider: meta?.provider,
          latencyMs: meta?.latencyMs,
        },
        'Answer evaluated'
      );

      return {
        answer: {
          id: savedAnswer.id,
          questionId: savedAnswer.questionId,
          answerText: savedAnswer.answerText,
          createdAt: savedAnswer.createdAt,
        },
        evaluation: mapEvaluation(evaluation),
        reused: false,
        guardrail: {
          flagged: guardrailFlagged,
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
