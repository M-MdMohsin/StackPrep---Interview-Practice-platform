import { prisma } from '../config/prisma';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { AppError } from './question.service';
import { UsageLimitService, UsageCapExceededError } from './usage-limit.service';
import { AIUsageService } from './ai-usage.service';
import { PromptVersionService } from './prompt-version.service';
import { AIService } from './ai.service';
import { AIServiceError } from '../errors/AIServiceError';
import { detectInjection } from './guardrail.service';
import { PROMPT_VERSIONS } from '../prompts/versions';
import { resumeAnalysisSchema, ValidatedResumeAnalysis } from '../validators/resume-analysis.validator';
import { ResumeDto, toResumeDto } from './resume.service';

export interface AnalyzeResumeResult {
  resume: ResumeDto;
  reused: boolean;
}

export class ResumeAnalysisService {
  /**
   * Analyzes an uploaded resume with AI and stores the structured result.
   * Runs under Redis lock "lock:resume-analyze:<resumeId>".
   */
  static async analyzeResume(resumeId: string, userId: string): Promise<AnalyzeResumeResult> {
    const lockKey = `lock:resume-analyze:${resumeId}`;
    let lockToken: string | null = null;

    // 1. Acquire Redis lock
    try {
      if (redis.status !== 'ready') {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
      }
      lockToken = await acquireLock(lockKey, 60);
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
    }

    if (!lockToken) {
      throw new AppError(409, 'ANALYSIS_IN_PROGRESS', 'Resume analysis already in progress', undefined, {
        'Retry-After': 2,
      });
    }

    try {
      // a. Load resume (owner check, else 404)
      const resume = await prisma.resume.findFirst({
        where: { id: resumeId, userId },
      });

      if (!resume) {
        throw new AppError(404, 'RESUME_NOT_FOUND', 'Resume not found');
      }

      // If already COMPLETED, return reused: true with no AI call
      if (resume.analysisStatus === 'COMPLETED') {
        return { resume: toResumeDto(resume), reused: true };
      }

      // b. Reserve usage (atomic)
      await UsageLimitService.getOrCreateUsageLimit(userId);
      try {
        await UsageLimitService.reserveUsage(userId);
      } catch (err) {
        if (err instanceof UsageCapExceededError) {
          await prisma.resume.update({
            where: { id: resumeId },
            data: { analysisError: 'USAGE_CAP_EXCEEDED' },
          });
          throw new AppError(429, 'USAGE_CAP_EXCEEDED', err.message, {
            scope: err.scope,
            resetAt: err.resetAt,
          });
        }
        throw err;
      }

      // c. Guardrail injection check (flag only, never block, never unset)
      const rawText = resume.rawText ?? '';
      const guardrailResult = detectInjection(rawText, 'resume');
      const guardrailFlagged = resume.guardrailFlagged || guardrailResult.flagged;

      if (guardrailResult.flagged && !resume.guardrailFlagged) {
        await prisma.resume.update({
          where: { id: resumeId },
          data: { guardrailFlagged: true },
        });
      }

      // d. Call AIService.analyzeResume on truncated text
      const maxChars = parseInt(process.env.RESUME_ANALYSIS_MAX_CHARS ?? '12000', 10);
      const truncatedText = rawText.slice(0, maxChars);

      let aiResult: any;
      let meta: any;
      let validatedData: ValidatedResumeAnalysis;

      try {
        aiResult = await AIService.analyzeResume({ resumeText: truncatedText });
        meta = aiResult.meta;

        const promptVersionId = await PromptVersionService.getOrCreatePromptVersion(
          'resumeAnalysis',
          PROMPT_VERSIONS.resumeAnalysis,
          meta.provider,
          meta.model
        ).catch(() => null);

        // e & f. Validate AI output and retry ONCE on invalid output
        const parseResult = resumeAnalysisSchema.safeParse(aiResult.data);

        if (!parseResult.success) {
          // Record failure for first attempt
          await AIUsageService.recordAIUsage({
            userId,
            provider: meta.provider,
            model: meta.model,
            requestType: 'RESUME_ANALYSIS',
            promptVersionId,
            latencyMs: meta.latencyMs,
            cacheHit: false,
            retryCount: meta.fallbackCount,
            status: 'FAILURE',
            failureCategory: 'VALIDATION',
          });

          // Retry ONCE under same reservation
          const retryResult = await AIService.analyzeResume({ resumeText: truncatedText });
          const retryMeta = retryResult.meta;
          const retryParse = resumeAnalysisSchema.safeParse(retryResult.data);

          const retryPromptVersionId = await PromptVersionService.getOrCreatePromptVersion(
            'resumeAnalysis',
            PROMPT_VERSIONS.resumeAnalysis,
            retryMeta.provider,
            retryMeta.model
          ).catch(() => null);

          if (!retryParse.success) {
            // Second failure: refund usage and mark resume FAILED
            await AIUsageService.recordAIUsage({
              userId,
              provider: retryMeta.provider,
              model: retryMeta.model,
              requestType: 'RESUME_ANALYSIS',
              promptVersionId: retryPromptVersionId,
              latencyMs: retryMeta.latencyMs,
              cacheHit: false,
              retryCount: retryMeta.fallbackCount,
              status: 'FAILURE',
              failureCategory: 'VALIDATION',
            });

            await UsageLimitService.refundUsage(userId);

            await prisma.resume.update({
              where: { id: resumeId },
              data: {
                analysisStatus: 'FAILED',
                analysisError: 'AI_OUTPUT_INVALID',
                guardrailFlagged,
              },
            });

            throw new AppError(502, 'AI_OUTPUT_INVALID', 'AI returned invalid resume analysis output after retry');
          }

          // Retry succeeded
          await AIUsageService.recordAIUsage({
            userId,
            provider: retryMeta.provider,
            model: retryMeta.model,
            requestType: 'RESUME_ANALYSIS',
            promptVersionId: retryPromptVersionId,
            latencyMs: retryMeta.latencyMs,
            cacheHit: false,
            retryCount: retryMeta.fallbackCount,
            status: 'SUCCESS',
            failureCategory: null,
          });

          validatedData = retryParse.data;
          meta = retryMeta;
        } else {
          // First attempt succeeded
          await AIUsageService.recordAIUsage({
            userId,
            provider: meta.provider,
            model: meta.model,
            requestType: 'RESUME_ANALYSIS',
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
            requestType: 'RESUME_ANALYSIS',
            promptVersionId: null,
            latencyMs: err.latencyMs,
            cacheHit: false,
            retryCount: Math.max(0, err.attempts.length - 1),
            status: 'FAILURE',
            failureCategory: 'ALL_PROVIDERS_FAILED',
          });

          await UsageLimitService.refundUsage(userId);

          await prisma.resume.update({
            where: { id: resumeId },
            data: {
              analysisStatus: 'FAILED',
              analysisError: 'AI_UNAVAILABLE',
              guardrailFlagged,
            },
          });

          throw new AppError(502, 'AI_UNAVAILABLE', 'All AI providers failed');
        }

        throw err;
      }

      // h. Success: store parsed fields, COMPLETED, analyzedAt, clear analysisError
      const updatedResume = await prisma.resume.update({
        where: { id: resumeId },
        data: {
          parsedData: {
            skills: validatedData.skills,
            projects: validatedData.projects,
            experience: validatedData.experience,
            education: validatedData.education,
            technologies: validatedData.technologies,
          },
          parsedEducation: validatedData.education,
          parsedTechnologies: validatedData.technologies,
          analysisStatus: 'COMPLETED',
          analysisError: null,
          analyzedAt: new Date(),
          guardrailFlagged,
        },
      });

      // Log summary metrics only (NEVER log resume text or parsed content)
      logger.info(
        {
          resumeId,
          userId,
          reused: false,
          provider: meta.provider,
          latencyMs: meta.latencyMs,
        },
        'Resume analysis completed'
      );

      return { resume: toResumeDto(updatedResume), reused: false };
    } finally {
      if (lockToken) {
        try {
          await releaseLock(lockKey, lockToken);
        } catch (err) {
          logger.error({ err }, 'Failed to release resume analyze Redis lock');
        }
      }
    }
  }
}
