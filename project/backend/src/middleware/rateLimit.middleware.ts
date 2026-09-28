import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { redis } from '../config/redis';
import { limitsConfig } from '../config/limits.config';

let redisConnected = false;
redis.on('connect', () => { redisConnected = true; });
redis.on('error', () => { redisConnected = false; });

const aiMemoryLimiter = new RateLimiterMemory({
  points: limitsConfig.aiRateLimitPerMin,
  duration: 60,
});
const interviewCreateMemoryLimiter = new RateLimiterMemory({
  points: limitsConfig.interviewCreateLimitPerHour,
  duration: 3600,
});

const makeAiRateLimiter = () => new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:ai',
  points: limitsConfig.aiRateLimitPerMin,
  duration: 60,
});

const makeInterviewCreateRateLimiter = () => new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:interview_create',
  points: limitsConfig.interviewCreateLimitPerHour,
  duration: 3600,
});

let _aiRateLimiter: RateLimiterRedis | null = null;
let _interviewCreateRateLimiter: RateLimiterRedis | null = null;

function getAiLimiter() {
  if (!redisConnected) return aiMemoryLimiter;
  if (!_aiRateLimiter) _aiRateLimiter = makeAiRateLimiter();
  return _aiRateLimiter;
}

function getInterviewCreateLimiter() {
  if (!redisConnected) return interviewCreateMemoryLimiter;
  if (!_interviewCreateRateLimiter) _interviewCreateRateLimiter = makeInterviewCreateRateLimiter();
  return _interviewCreateRateLimiter;
}

function makeRateLimitMiddleware(getLimiter: () => any) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }
    try {
      const limiter = getLimiter();
      await limiter.consume(userId);
      next();
    } catch (err: any) {
      if (err && typeof err.msBeforeNext === 'number') {
        const retryAfterSeconds = Math.ceil(err.msBeforeNext / 1000);
        res.setHeader('Retry-After', retryAfterSeconds);
        res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMITED',
          retryAfterSeconds,
        });
      } else {
        console.warn('[RateLimit] Error:', err);
        next();
      }
    }
  };
}

export const aiRateLimiter = makeRateLimitMiddleware(getAiLimiter);
export const interviewCreateRateLimiter = makeRateLimitMiddleware(getInterviewCreateLimiter);
