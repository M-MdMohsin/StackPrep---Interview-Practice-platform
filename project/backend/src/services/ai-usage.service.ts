import { prisma } from '../config/prisma';
import { logger } from '../config/logger';

interface RecordAIUsageParams {
  userId: string;
  provider: string;
  model: string;
  requestType: string;
  promptVersionId?: string | null;
  latencyMs: number;
  cacheHit: boolean;
  retryCount: number;
  status: 'SUCCESS' | 'FAILURE';
  failureCategory?: string | null;
}

export class AIUsageService {
  static async recordAIUsage(params: RecordAIUsageParams): Promise<void> {
    try {
      await prisma.aIUsage.create({
        data: {
          userId: params.userId,
          provider: params.provider,
          model: params.model,
          requestType: params.requestType,
          promptVersionId: params.promptVersionId ?? null,
          latencyMs: params.latencyMs,
          cacheHit: params.cacheHit,
          retryCount: params.retryCount,
          status: params.status,
          failureCategory: params.failureCategory ?? null,
          inputTokens: null,
          outputTokens: null,
          estimatedCost: null,
        },
      });
    } catch (err) {
      logger.error({ err }, '[AIUsageService] Failed to record AI usage');
    }
  }
}
