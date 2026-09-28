import { Router } from 'express';
import { QuestionController } from '../controllers/question.controller';
import { authenticate } from '../middleware/auth.middleware';
import { aiRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router({ mergeParams: true });

router.post('/generate', authenticate, aiRateLimiter, QuestionController.generateQuestion);

export default router;
