import { Request, Response } from 'express';
import { QuestionService, AppError } from '../services/question.service';
import { questionParamsSchema } from '../validators/question.validator';
import { UsageCapExceededError } from '../services/usage-limit.service';
import { logger } from '../config/logger';

export class QuestionController {
  static async generateQuestion(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const paramsResult = questionParamsSchema.safeParse(req.params);
      if (!paramsResult.success) {
        res.status(400).json({
          error: 'Invalid interview ID',
          code: 'INVALID_INTERVIEW_ID',
        });
        return;
      }

      const { id: interviewId } = paramsResult.data;
      const userId = req.user.id;

      const result = await QuestionService.generateQuestion(interviewId, userId);

      const statusCode = result.reused ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err: any) {
      logger.error({ err }, 'Generate question error');

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
