import { prisma } from '../config/prisma';
import { CreateInterviewInput } from '../validators/interview.validator';
import { ForbiddenError } from './authorization.service';

export class UsageLimitExceededError extends Error {
  statusCode = 429;
  constructor(message = 'Usage limit exceeded: You have reached your interview creation cap') {
    super(message);
    this.name = 'UsageLimitExceededError';
  }
}

export class InterviewNotFoundError extends Error {
  statusCode = 404;
  constructor(interviewId: string) {
    super(`Interview not found: ${interviewId}`);
    this.name = 'InterviewNotFoundError';
  }
}

export class InterviewService {
  /**
   * Stub usage-limit check. Full enforcement lands in Step 7.
   * Queries the UsageLimit record for the user so the check is wired — it
   * just doesn't hard-block yet (returns false). Replace the body in Step 7.
   */
  static async checkUsageLimit(userId: string): Promise<void> {
    const usageLimit = await prisma.usageLimit.findUnique({
      where: { userId },
    });

    // Step 7 will enforce these caps properly.
    // For now we just ensure the record exists and the query path is wired.
    // If the record doesn't exist yet it means no limits have been set — allow.
    if (!usageLimit) {
      return;
    }

    // TODO (Step 7): count today's AIUsage rows for this user and throw
    // UsageLimitExceededError when dailyRequestCap / monthlyRequestCap is reached.
  }

  /**
   * Creates a new Interview record for the given user.
   */
  static async createInterview(
    userId: string,
    data: CreateInterviewInput
  ) {
    // Stub usage-limit check — wired now, enforced in Step 7.
    await InterviewService.checkUsageLimit(userId);

    const interview = await prisma.interview.create({
      data: {
        userId,
        role: data.role,
        experienceLevel: data.experienceLevel,
        interviewType: data.interviewType,
        difficulty: data.difficulty,
        questionLimit: data.questionLimit ?? 5,
        resumeId: data.resumeId ?? null,
        status: 'IN_PROGRESS',
      },
      select: {
        id: true,
        userId: true,
        role: true,
        experienceLevel: true,
        interviewType: true,
        difficulty: true,
        questionLimit: true,
        status: true,
        resumeId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return interview;
  }

  /**
   * Retrieves an interview by ID.
   * Throws 404 if not found, 403 if the requesting user doesn't own it.
   */
  static async getInterviewById(interviewId: string, requestingUserId: string) {
    const interview = await prisma.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true,
        userId: true,
        role: true,
        experienceLevel: true,
        interviewType: true,
        difficulty: true,
        questionLimit: true,
        status: true,
        overallScore: true,
        summaryFeedback: true,
        resumeId: true,
        createdAt: true,
        updatedAt: true,
        questions: {
          select: {
            id: true,
            questionText: true,
            topic: true,
            difficulty: true,
            orderIndex: true,
            status: true,
            createdAt: true,
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!interview) {
      throw new InterviewNotFoundError(interviewId);
    }

    if (interview.userId !== requestingUserId) {
      throw new ForbiddenError('Forbidden: You do not have access to this interview');
    }

    return interview;
  }
}
