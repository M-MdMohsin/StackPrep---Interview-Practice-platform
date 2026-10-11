import { Router } from 'express';
import { AnswerController } from '../controllers/answer.controller';
import { authenticate } from '../middleware/auth.middleware';
import { aiRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router({ mergeParams: true });

// POST /api/questions/:questionId/answers
router.post('/', authenticate, aiRateLimiter, AnswerController.submitAnswer);

export default router;
