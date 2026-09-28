import { AIAttempt } from '../types/ai.types';

export class AIServiceError extends Error {
  readonly attempts: AIAttempt[];
  readonly latencyMs: number;

  constructor(attempts: AIAttempt[], latencyMs: number) {
    super(`All AI providers failed after ${attempts.length} attempt(s)`);
    this.name = 'AIServiceError';
    this.attempts = attempts;
    this.latencyMs = latencyMs;
  }
}
