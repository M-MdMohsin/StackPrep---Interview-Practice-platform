import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResumeAnalysisService } from '../../src/services/resume-analysis.service';
import { prisma } from '../../src/config/prisma';
import { redis } from '../../src/config/redis';
import * as redisLockModule from '../../src/utils/redisLock';
import { UsageLimitService, UsageCapExceededError } from '../../src/services/usage-limit.service';
import { AIService } from '../../src/services/ai.service';
import { AIServiceError } from '../../src/errors/AIServiceError';
import { AIUsageService } from '../../src/services/ai-usage.service';
import { PromptVersionService } from '../../src/services/prompt-version.service';

describe('ResumeAnalysisService - Unit Tests with Mocks', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const resumeId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(redis, 'status', { value: 'ready', configurable: true });
    vi.spyOn(redisLockModule, 'acquireLock').mockResolvedValue('mock-lock-token');
    vi.spyOn(redisLockModule, 'releaseLock').mockResolvedValue(undefined);
    vi.spyOn(PromptVersionService, 'getOrCreatePromptVersion').mockResolvedValue('prompt-v1');
    vi.spyOn(AIUsageService, 'recordAIUsage').mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Invalid AI output retry and failure flow', () => {
    it('retries once on invalid output; if still invalid, refunds usage, sets FAILED, and throws 502 AI_OUTPUT_INVALID', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        userId,
        rawText: 'John Doe - Software Engineer at Acme',
        analysisStatus: 'PENDING',
        guardrailFlagged: false,
      } as any);

      vi.spyOn(UsageLimitService, 'getOrCreateUsageLimit').mockResolvedValue({} as any);
      const reserveSpy = vi.spyOn(UsageLimitService, 'reserveUsage').mockResolvedValue({} as any);
      const refundSpy = vi.spyOn(UsageLimitService, 'refundUsage').mockResolvedValue({} as any);

      // AI returns invalid output (all arrays empty) twice
      const invalidAiOutput = {
        data: { skills: [], technologies: [], projects: [], experience: [], education: [] },
        meta: { provider: 'gemini', model: 'gemini-1.5-flash', latencyMs: 120, fallbackCount: 0 },
      };
      const aiSpy = vi.spyOn(AIService, 'analyzeResume').mockResolvedValue(invalidAiOutput as any);

      const updateSpy = vi.spyOn(prisma.resume, 'update').mockResolvedValue({} as any);

      await expect(
        ResumeAnalysisService.analyzeResume(resumeId, userId)
      ).rejects.toMatchObject({
        statusCode: 502,
        code: 'AI_OUTPUT_INVALID',
      });

      // Reserved once
      expect(reserveSpy).toHaveBeenCalledTimes(1);
      // AI called twice (1 initial + 1 retry)
      expect(aiSpy).toHaveBeenCalledTimes(2);
      // Usage refunded on final failure
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledWith(userId);

      // Status updated to FAILED with analysisError 'AI_OUTPUT_INVALID'
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: resumeId },
        data: expect.objectContaining({
          analysisStatus: 'FAILED',
          analysisError: 'AI_OUTPUT_INVALID',
        }),
      });
    });
  });

  describe('AIServiceError handling', () => {
    it('refunds usage, sets FAILED with AI_UNAVAILABLE, and throws 502 when all providers fail', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        userId,
        rawText: 'John Doe - Software Engineer at Acme',
        analysisStatus: 'PENDING',
        guardrailFlagged: false,
      } as any);

      vi.spyOn(UsageLimitService, 'getOrCreateUsageLimit').mockResolvedValue({} as any);
      vi.spyOn(UsageLimitService, 'reserveUsage').mockResolvedValue({} as any);
      const refundSpy = vi.spyOn(UsageLimitService, 'refundUsage').mockResolvedValue({} as any);

      const aiError = new AIServiceError(
        [
          { provider: 'gemini', model: 'gemini-1.5-flash', message: 'Quota exceeded', timedOut: false },
          { provider: 'groq', model: 'llama-3.3-70b-versatile', message: 'Rate limit', timedOut: false },
        ],
        450
      );
      vi.spyOn(AIService, 'analyzeResume').mockRejectedValue(aiError);

      const updateSpy = vi.spyOn(prisma.resume, 'update').mockResolvedValue({} as any);

      await expect(
        ResumeAnalysisService.analyzeResume(resumeId, userId)
      ).rejects.toMatchObject({
        statusCode: 502,
        code: 'AI_UNAVAILABLE',
      });

      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect(refundSpy).toHaveBeenCalledWith(userId);

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: resumeId },
        data: expect.objectContaining({
          analysisStatus: 'FAILED',
          analysisError: 'AI_UNAVAILABLE',
        }),
      });
    });
  });

  describe('Already COMPLETED resume', () => {
    it('returns reused: true without calling AI or reserving usage', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        userId,
        originalFilename: 'resume.pdf',
        fileSizeBytes: 1024,
        pageCount: 1,
        analysisStatus: 'COMPLETED',
        analysisError: null,
        guardrailFlagged: false,
        createdAt: new Date(),
        analyzedAt: new Date(),
        parsedData: {
          skills: ['TypeScript'],
          technologies: ['Docker'],
          projects: [],
          experience: [],
          education: [],
        },
        parsedEducation: [],
        parsedTechnologies: ['Docker'],
      } as any);

      const reserveSpy = vi.spyOn(UsageLimitService, 'reserveUsage');
      const aiSpy = vi.spyOn(AIService, 'analyzeResume');

      const result = await ResumeAnalysisService.analyzeResume(resumeId, userId);

      expect(result.reused).toBe(true);
      expect(result.resume.analysisStatus).toBe('COMPLETED');
      expect(result.resume.parsed?.skills).toEqual(['TypeScript']);
      expect(reserveSpy).not.toHaveBeenCalled();
      expect(aiSpy).not.toHaveBeenCalled();
    });
  });

  describe('Usage cap refused', () => {
    it('sets analysisError USAGE_CAP_EXCEEDED and throws 429 without calling AI', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        userId,
        rawText: 'Some resume text',
        analysisStatus: 'PENDING',
        guardrailFlagged: false,
      } as any);

      vi.spyOn(UsageLimitService, 'getOrCreateUsageLimit').mockResolvedValue({} as any);
      vi.spyOn(UsageLimitService, 'reserveUsage').mockRejectedValue(
        new UsageCapExceededError('DAILY', new Date())
      );

      const aiSpy = vi.spyOn(AIService, 'analyzeResume');
      const updateSpy = vi.spyOn(prisma.resume, 'update').mockResolvedValue({} as any);

      await expect(
        ResumeAnalysisService.analyzeResume(resumeId, userId)
      ).rejects.toMatchObject({
        statusCode: 429,
        code: 'USAGE_CAP_EXCEEDED',
      });

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: resumeId },
        data: { analysisError: 'USAGE_CAP_EXCEEDED' },
      });

      expect(aiSpy).not.toHaveBeenCalled();
    });
  });
});
