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
    createdAt: Date;
  };
  reused: boolean;
  progress: { current: number; total: number };
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
    createdAt: q.createdAt,
  };
}

export class QuestionService {
  static async generateQuestion(interviewId: string, userId: string): Promise<GenerateResult> {
    let interview: any;
    try {
      interview = await prisma.interview.findUnique({
        where: { id: interviewId },
        include: {
          questions: {
            where: { parentQuestionId: null },
            orderBy: { orderIndex: 'asc' },
            include: {
              answers: { select: { id: true }, take: 1 },
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

    try {
      const questions = interview.questions as any[];
      const topLevelQuestions = questions;

      const pendingQuestion = [...questions]
        .reverse()
        .find((q: any) => q.answers.length === 0);

      if (pendingQuestion) {
        reused = true;
        resultQuestion = pendingQuestion;
        logger.info({ interviewId, userId, reused: true, provider: null, latencyMs: 0 }, 'Returning existing pending question');
        return {
          question: mapQuestion(resultQuestion),
          reused: true,
          progress: { current: resultQuestion.orderIndex, total: interview.questionLimit },
        };
      }

      if (topLevelQuestions.length >= interview.questionLimit) {
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

      const previousQuestions = questions.map((q: any) => q.questionText);
      let aiResult: any;
      let meta: any;
      let validatedData: any;

      try {
        aiResult = await AIService.generateQuestion({
          role: interview.role,
          experienceLevel: interview.experienceLevel,
          interviewType: interview.interviewType,
          difficulty: interview.difficulty,
          previousQuestions,
        });
        meta = aiResult.meta;
        validatedData = aiResult.data;

        const promptVersionId = await PromptVersionService.getOrCreatePromptVersion(
          'question-generation',
          PROMPT_VERSIONS.questionGeneration.split('@')[1] ? `v${PROMPT_VERSIONS.questionGeneration.split('@')[1]}` : 'v1',
          meta.provider,
          meta.model,
        ).catch(() => null);

        const parseResult = generatedQuestionSchema.safeParse(validatedData);
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
          validatedData = retryParseResult.data;
          meta = retryMeta;
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
          validatedData = parseResult.data;
        }

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

      const existingTexts = questions.map((q: any) => q.questionText.trim().toLowerCase().replace(/\s+/g, ' '));
      const newText = validatedData.questionText.trim().toLowerCase().replace(/\s+/g, ' ');
      if (existingTexts.includes(newText)) {
        await UsageLimitService.refundUsage(userId);
        throw new AppError(502, 'AI_OUTPUT_INVALID', 'AI generated a duplicate question');
      }

      const nextOrder = topLevelQuestions.length > 0
        ? Math.max(...topLevelQuestions.map((q: any) => q.orderIndex)) + 1
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
                where: { parentQuestionId: null },
                orderBy: { orderIndex: 'asc' },
                include: { answers: { select: { id: true }, take: 1 } },
              },
            },
          });
          const pending = refetched?.questions?.find((q: any) => q.answers.length === 0);
          if (pending) {
            reused = true;
            resultQuestion = pending;
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
        reused,
        provider: meta?.provider,
        latencyMs: meta?.latencyMs,
      }, 'Question generated');

      return {
        question: mapQuestion(resultQuestion),
        reused,
        progress: {
          current: resultQuestion.orderIndex,
          total: interview.questionLimit,
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
