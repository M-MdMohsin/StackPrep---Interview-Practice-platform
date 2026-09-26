import { Request, Response } from 'express';
import { InterviewService } from '../services/interview.service';
import { createInterviewSchema } from '../validators/interview.validator';
import { logger } from '../config/logger';

export class InterviewController {
  /**
   * POST /api/interviews
   * Creates a new interview for the authenticated user.
   */
  static async createInterview(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const validationResult = createInterviewSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validationResult.error.format(),
        });
        return;
      }

      const interview = await InterviewService.createInterview(
        req.user.id,
        validationResult.data
      );

      logger.info({ userId: req.user.id, interviewId: interview.id }, 'Interview created');
      res.status(201).json({ interview });
    } catch (error: any) {
      logger.error({ err: error }, 'Create interview error');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to create interview' });
    }
  }

  /**
   * GET /api/interviews/:id
   * Retrieves an interview by ID — ownership-checked.
   */
  static async getInterview(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      if (!id) {
        res.status(400).json({ error: 'Interview ID is required' });
        return;
      }

      const interview = await InterviewService.getInterviewById(id, req.user.id);

      res.status(200).json({ interview });
    } catch (error: any) {
      logger.error({ err: error }, 'Get interview error');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to retrieve interview' });
    }
  }
}
