export const limitsConfig = {
  aiRateLimitPerMin: parseInt(process.env.AI_RATE_LIMIT_PER_MIN ?? '20', 10),
  interviewCreateLimitPerHour: parseInt(process.env.INTERVIEW_CREATE_LIMIT_PER_HOUR ?? '5', 10),
  defaultDailyAiLimit: parseInt(process.env.DEFAULT_DAILY_AI_LIMIT ?? '50', 10),
  defaultMonthlyAiLimit: parseInt(process.env.DEFAULT_MONTHLY_AI_LIMIT ?? '500', 10),
  generationLockTtlSeconds: parseInt(process.env.GENERATION_LOCK_TTL_SECONDS ?? '45', 10),
};
