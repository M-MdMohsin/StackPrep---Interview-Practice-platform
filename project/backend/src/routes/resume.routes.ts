import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { resumeUploadRateLimiter, aiRateLimiter } from '../middleware/rateLimit.middleware';
import { ResumeController, multerMiddleware } from '../controllers/resume.controller';

const router = Router();

/**
 * POST /api/resumes
 * Middleware order: auth -> resumeUploadRateLimiter -> aiRateLimiter -> multer -> controller
 * Unauthenticated requests never reach multer or touch disk.
 */
router.post(
  '/',
  authenticate,
  resumeUploadRateLimiter,
  aiRateLimiter,
  multerMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    ResumeController.uploadResume(req, res).catch(next);
  }
);

/**
 * POST /api/resumes/:id/analyze
 * Middleware order: auth -> shared aiRateLimiter -> controller
 */
router.post(
  '/:id/analyze',
  authenticate,
  aiRateLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    ResumeController.analyzeResume(req, res).catch(next);
  }
);

/**
 * GET /api/resumes
 */
router.get('/', authenticate, (req: Request, res: Response, next: NextFunction) => {
  ResumeController.listResumes(req, res).catch(next);
});

/**
 * GET /api/resumes/:id
 */
router.get('/:id', authenticate, (req: Request, res: Response, next: NextFunction) => {
  ResumeController.getResume(req, res).catch(next);
});

/**
 * DELETE /api/resumes/:id
 */
router.delete('/:id', authenticate, (req: Request, res: Response, next: NextFunction) => {
  ResumeController.deleteResume(req, res).catch(next);
});

export default router;
