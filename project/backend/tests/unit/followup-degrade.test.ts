import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy_gemini_key_for_test';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'dummy_groq_key_for_test';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'dummy_openrouter_key_for_test';

import { QuestionService, AppError } from '../../src/services/question.service';
import { AIService } from '../../src/services/ai.service';
import { AIServiceError } from '../../src/errors/AIServiceError';
import { prisma } from '../../src/config/prisma';
import { UsageLimitService } from '../../src/services/usage-limit.service';
import { PromptVersionService } from '../../src/services/prompt-version.service';
import { AIUsageService } from '../../src/services/ai-usage.service';
import * as redisLock from '../../src/utils/redisLock';

vi.mock('../../src/services/usage-limit.service');
vi.mock('../../src/services/prompt-version.service');
vi.mock('../../src/services/ai-usage.service');
vi.mock('../../src/utils/redisLock');
vi.mock('../../src/config/prisma', () => ({
  prisma: {
    interview: {
      findUnique: vi.fn(),
    },
    question: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Follow-Up Degrade & Failure Modes', () => {
  const mockUserId = 'user-123e4567-e89b-12d3-a456-426614174000';
  const mockInterviewId = 'int-123e4567-e89b-12d3-a456-426614174000';

  const mockInterview = {
    id: mockInterviewId,
    userId: mockUserId,
    status: 'IN_PROGRESS',
    role: 'Backend Engineer',
    experienceLevel: 'MID',
    interviewType: 'TECHNICAL',
    difficulty: 'MEDIUM',
    questionLimit: 5,
    questions: [
      {
        id: 'q-parent',
        orderIndex: 1,
        parentQuestionId: null,
        questionText: 'Explain database indexing principles in detail.',
        difficulty: 'MEDIUM',
        answers: [
          {
            id: 'ans-1',
            answerText: 'Indexes make lookups fast using B-trees.',
            evaluation: {
              id: 'eval-1',
              score: 4,
              accuracyScore: 5,
              clarityScore: 6,
              completenessScore: 4,
              relevanceScore: 7,
              communicationScore: 6,
              strengths: ['Mentions B-trees'],
              weaknesses: ['Misses write overhead'],
              missingConcepts: ['Write amplification', 'Disk I/O'],
              feedback: 'Good start but needs write trade-offs.',
              idealAnswer: 'Ideal answer text...',
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(redisLock, 'acquireLock').mockResolvedValue('test-lock-token');
    vi.spyOn(redisLock, 'releaseLock').mockResolvedValue();
    vi.spyOn(UsageLimitService, 'getOrCreateUsageLimit').mockResolvedValue({} as any);
    vi.spyOn(UsageLimitService, 'reserveUsage').mockResolvedValue();
    vi.spyOn(UsageLimitService, 'refundUsage').mockResolvedValue();
    vi.spyOn(PromptVersionService, 'getOrCreatePromptVersion').mockResolvedValue('mock-prompt-v1');
    vi.spyOn(AIUsageService, 'recordAIUsage').mockResolvedValue();

    (prisma.interview.findUnique as any).mockResolvedValue(mockInterview);
    (prisma.question.create as any).mockImplementation(({ data }: any) => ({
      id: 'q-created',
      createdAt: new Date(),
      ...data,
    }));
  });

  it('fails open when generateFollowUp returns invalid output twice: falls through to generateQuestion, refunds usage, and returns a top-level question', async () => {
    // Both follow-up attempts return invalid output (questionText < 15 chars)
    const invalidFollowUpData = {
      questionText: 'Too short',
      topic: 'Databases',
      category: 'Data Structures',
      difficulty: 'MEDIUM',
      questionType: 'conceptual',
    };

    const validTopLevelData = {
      questionText: 'How would you design a rate limiter using Redis and sliding windows?',
      topic: 'System Design',
      category: 'Architecture',
      difficulty: 'MEDIUM',
      questionType: 'system-design',
    };

    const generateFollowUpMock = vi
      .spyOn(AIService, 'generateFollowUp')
      .mockResolvedValue({
        data: invalidFollowUpData as any,
        meta: { provider: 'gemini', model: 'gemini-2.5', latencyMs: 200, fallbackCount: 0 },
      });

    const generateQuestionMock = vi
      .spyOn(AIService, 'generateQuestion')
      .mockResolvedValue({
        data: validTopLevelData as any,
        meta: { provider: 'gemini', model: 'gemini-2.5', latencyMs: 250, fallbackCount: 0 },
      });

    const result = await QuestionService.generateQuestion(mockInterviewId, mockUserId);

    // generateFollowUp was called twice (initial + 1 retry)
    expect(generateFollowUpMock).toHaveBeenCalledTimes(2);

    // After 2nd invalid follow-up attempt, usage was refunded
    expect(UsageLimitService.refundUsage).toHaveBeenCalledWith(mockUserId);

    // Then it fell through to generateQuestion for top-level question
    expect(generateQuestionMock).toHaveBeenCalledTimes(1);

    // Result should be a top-level question, not a follow-up
    expect(result.question.isFollowUp).toBe(false);
    expect(result.question.parentQuestionId).toBeNull();
    expect(result.question.questionText).toBe(validTopLevelData.questionText);
    expect(prisma.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentQuestionId: null,
          source: 'AI_GENERATED',
        }),
      })
    );
  });

  it('fails closed when generateFollowUp throws AIServiceError: throws 502 AI_UNAVAILABLE, refunds usage, and does NOT call generateQuestion', async () => {
    const aiError = new AIServiceError(
      [{ provider: 'gemini', model: 'gemini-2.5', message: 'API quota exceeded', timedOut: false }],
      500
    );

    const generateFollowUpMock = vi
      .spyOn(AIService, 'generateFollowUp')
      .mockRejectedValue(aiError);

    const generateQuestionMock = vi.spyOn(AIService, 'generateQuestion');

    let thrownError: any = null;
    try {
      await QuestionService.generateQuestion(mockInterviewId, mockUserId);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    expect(thrownError.statusCode).toBe(502);
    expect(thrownError.code).toBe('AI_UNAVAILABLE');

    // Follow-up was called
    expect(generateFollowUpMock).toHaveBeenCalledTimes(1);

    // Usage was refunded
    expect(UsageLimitService.refundUsage).toHaveBeenCalledWith(mockUserId);

    // generateQuestion was NEVER called
    expect(generateQuestionMock).not.toHaveBeenCalled();

    // AIUsage failure was recorded
    expect(AIUsageService.recordAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: 'FOLLOW_UP',
        status: 'FAILURE',
        failureCategory: 'ALL_PROVIDERS_FAILED',
      })
    );
  });
});
