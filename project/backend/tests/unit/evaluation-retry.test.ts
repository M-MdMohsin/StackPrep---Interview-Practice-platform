import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy_gemini_key_for_test';
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'dummy_groq_key_for_test';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'dummy_openrouter_key_for_test';

import { AnswerService } from '../../src/services/answer.service';
import { AIService } from '../../src/services/ai.service';
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
    question: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    answer: {
      create: vi.fn(),
      update: vi.fn(),
    },
    evaluation: {
      create: vi.fn(),
    },
  },
}));

describe('AnswerService Evaluation Retry Flow', () => {
  const mockUserId = 'user-123e4567-e89b-12d3-a456-426614174000';
  const mockQuestionId = '987fcdeb-51a2-43f7-9876-543210987654';

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(redisLock, 'acquireLock').mockResolvedValue('test-lock-token');
    vi.spyOn(redisLock, 'releaseLock').mockResolvedValue();
    vi.spyOn(UsageLimitService, 'getOrCreateUsageLimit').mockResolvedValue({} as any);
    vi.spyOn(UsageLimitService, 'reserveUsage').mockResolvedValue();
    vi.spyOn(UsageLimitService, 'refundUsage').mockResolvedValue();
    vi.spyOn(PromptVersionService, 'getOrCreatePromptVersion').mockResolvedValue('mock-prompt-v1');
    vi.spyOn(AIUsageService, 'recordAIUsage').mockResolvedValue();

    (prisma.question.findUnique as any).mockResolvedValue({
      id: mockQuestionId,
      questionText: 'Explain event loop in Node.js',
      role: 'Backend Engineer',
      difficulty: 'MEDIUM',
      interview: {
        userId: mockUserId,
        status: 'IN_PROGRESS',
        role: 'Backend Engineer',
        difficulty: 'MEDIUM',
        questions: [
          {
            id: mockQuestionId,
            orderIndex: 1,
            parentQuestionId: null,
            answers: [],
          },
        ],
      },
      answers: [],
    });

    (prisma.answer.create as any).mockResolvedValue({
      id: 'ans-123',
      questionId: mockQuestionId,
      answerText: 'The event loop processes non-blocking I/O callbacks in phases.',
      createdAt: new Date(),
    });

    (prisma.evaluation.create as any).mockImplementation(({ data }: any) => ({
      id: 'eval-123',
      ...data,
      createdAt: new Date(),
    }));
  });

  it('retries once if the first AI evaluation returns an invalid score (> 10) and saves the valid retry result', async () => {
    const invalidEvaluation = {
      score: 150, // Invalid score
      accuracyScore: 9,
      clarityScore: 8,
      completenessScore: 8,
      relevanceScore: 9,
      communicationScore: 8,
      strengths: ['Accurate conceptual model'],
      weaknesses: ['Missed microtasks distinction'],
      missingConcepts: ['process.nextTick vs setImmediate'],
      feedback: 'Overall solid explanation with clear mechanics.',
      idealAnswer: 'The event loop offloads operations to the system kernel whenever possible.',
    };

    const validEvaluation = {
      score: 9, // Valid score
      accuracyScore: 9,
      clarityScore: 8,
      completenessScore: 8,
      relevanceScore: 9,
      communicationScore: 8,
      strengths: ['Accurate conceptual model'],
      weaknesses: ['Missed microtasks distinction'],
      missingConcepts: ['process.nextTick vs setImmediate'],
      feedback: 'Overall solid explanation with clear mechanics.',
      idealAnswer: 'The event loop offloads operations to the system kernel whenever possible.',
    };

    const evaluateAnswerMock = vi
      .spyOn(AIService, 'evaluateAnswer')
      .mockResolvedValueOnce({
        data: invalidEvaluation as any,
        meta: {
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          latencyMs: 300,
          fallbackCount: 0,
        },
      })
      .mockResolvedValueOnce({
        data: validEvaluation as any,
        meta: {
          provider: 'groq',
          model: 'openai/gpt-oss-120b',
          latencyMs: 350,
          fallbackCount: 0,
        },
      });

    const result = await AnswerService.submitAnswer(mockQuestionId, mockUserId, {
      answerText: 'The event loop processes non-blocking I/O callbacks in phases.',
    });

    // Verify AIService.evaluateAnswer was called twice
    expect(evaluateAnswerMock).toHaveBeenCalledTimes(2);

    // Verify usage limit was only reserved once (single cap reservation)
    expect(UsageLimitService.reserveUsage).toHaveBeenCalledTimes(1);
    expect(UsageLimitService.refundUsage).not.toHaveBeenCalled();

    // Verify AIUsage recorded both the failure and the success
    expect(AIUsageService.recordAIUsage).toHaveBeenCalledTimes(2);
    expect(AIUsageService.recordAIUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: 'FAILURE',
        failureCategory: 'VALIDATION',
      })
    );
    expect(AIUsageService.recordAIUsage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: 'SUCCESS',
      })
    );

    // Verify Evaluation was created with valid score 9 (not 150)
    expect(prisma.evaluation.create).toHaveBeenCalledTimes(1);
    expect(prisma.evaluation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 9,
        }),
      })
    );

    // Verify returned result
    expect(result.reused).toBe(false);
    expect(result.evaluation.score).toBe(9);
    expect(result.answer.id).toBe('ans-123');
  });
});
