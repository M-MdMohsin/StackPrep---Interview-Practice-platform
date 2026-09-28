import { prisma } from '../config/prisma';
import { limitsConfig } from '../config/limits.config';

export class UsageCapExceededError extends Error {
  statusCode = 429;
  code = 'USAGE_CAP_EXCEEDED';
  scope: 'daily' | 'monthly';
  resetAt: string;

  constructor(scope: 'daily' | 'monthly', resetAt: Date) {
    super(`Usage cap exceeded (${scope})`);
    this.name = 'UsageCapExceededError';
    this.scope = scope;
    this.resetAt = resetAt.toISOString();
  }
}

function nextDailyReset(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next;
}

function nextMonthlyReset(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next;
}

export class UsageLimitService {
  static async getOrCreateUsageLimit(userId: string) {
    let record = await prisma.usageLimit.findUnique({ where: { userId } });
    if (!record) {
      record = await prisma.usageLimit.create({
        data: {
          userId,
          dailyLimit: limitsConfig.defaultDailyAiLimit,
          monthlyLimit: limitsConfig.defaultMonthlyAiLimit,
          dailyUsed: 0,
          monthlyUsed: 0,
          dailyResetAt: nextDailyReset(),
          monthlyResetAt: nextMonthlyReset(),
          dailyRequestCap: limitsConfig.defaultDailyAiLimit,
          monthlyRequestCap: limitsConfig.defaultMonthlyAiLimit,
          dailyCostCap: 5.0,
          monthlyCostCap: 50.0,
        },
      });
    }
    return record;
  }

  static async rolloverIfNeeded(userId: string): Promise<void> {
    const now = new Date();
    const record = await prisma.usageLimit.findUnique({ where: { userId } });
    if (!record) return;

    const updates: Record<string, any> = {};
    if (now >= record.dailyResetAt) {
      updates.dailyUsed = 0;
      updates.dailyResetAt = nextDailyReset();
    }
    if (now >= record.monthlyResetAt) {
      updates.monthlyUsed = 0;
      updates.monthlyResetAt = nextMonthlyReset();
    }

    if (Object.keys(updates).length > 0) {
      await prisma.usageLimit.update({ where: { userId }, data: updates });
    }
  }

  static async reserveUsage(userId: string): Promise<void> {
    await this.rolloverIfNeeded(userId);

    // Atomic conditional increment
    const result = await prisma.$executeRaw`
      UPDATE "UsageLimit"
      SET "dailyUsed" = "dailyUsed" + 1, "monthlyUsed" = "monthlyUsed" + 1
      WHERE "userId" = ${userId}
        AND "dailyUsed" < "dailyLimit" AND "monthlyUsed" < "monthlyLimit"
    `;

    if (result === 0) {
      // Read to determine scope
      const record = await prisma.usageLimit.findUnique({ where: { userId } });
      if (!record) throw new Error('UsageLimit record not found after failed increment');
      
      const scope: 'daily' | 'monthly' =
        record.dailyUsed >= record.dailyLimit ? 'daily' : 'monthly';
      const resetAt = scope === 'daily' ? record.dailyResetAt : record.monthlyResetAt;
      throw new UsageCapExceededError(scope, resetAt);
    }
  }

  static async refundUsage(userId: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE "UsageLimit"
        SET
          "dailyUsed" = GREATEST("dailyUsed" - 1, 0),
          "monthlyUsed" = GREATEST("monthlyUsed" - 1, 0)
        WHERE "userId" = ${userId}
      `;
    } catch (err) {
      console.error('[UsageLimitService] refundUsage failed:', (err as Error).message);
    }
  }

  static async assertWithinLimit(userId: string): Promise<void> {
    await this.rolloverIfNeeded(userId);
    const record = await prisma.usageLimit.findUnique({ where: { userId } });
    if (!record) return; // no record = no limit enforced

    if (record.dailyUsed >= record.dailyLimit) {
      throw new UsageCapExceededError('daily', record.dailyResetAt);
    }
    if (record.monthlyUsed >= record.monthlyLimit) {
      throw new UsageCapExceededError('monthly', record.monthlyResetAt);
    }
  }
}
