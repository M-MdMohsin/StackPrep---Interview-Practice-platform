import { Request, Response } from 'express';
import { AnswerService } from '../services/answer.service';
import { AppError } from '../services/question.service';
import { UsageCapExceededError } from '../services/usage-limit.service';
import { logger } from '../config/logger';

export class AnswerController {
  static async submitAnswer(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const rawQuestionId = req.params.questionId;
      const questionId = Array.isArray(rawQuestionId) ? rawQuestionId[0] : rawQuestionId;

      const result = await AnswerService.submitAnswer(questionId, req.user.id, req.body);

      const statusCode = result.reused ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err: any) {
      logger.error({ err }, 'Submit answer error');

      if (err instanceof AppError) {
        if (err.headers) {
          for (const [key, val] of Object.entries(err.headers)) {
            res.setHeader(key, val);
          }
        }
        const body: any = { error: err.message, code: err.code };
        if (err.extra) Object.assign(body, err.extra);
        res.status(err.statusCode).json(body);
        return;
      }

      if (err instanceof UsageCapExceededError) {
        res.status(429).json({
          error: err.message,
          code: 'USAGE_CAP_EXCEEDED',
          scope: err.scope,
          resetAt: err.resetAt,
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    }
  }
}
