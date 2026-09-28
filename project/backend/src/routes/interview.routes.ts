import { Router } from 'express';
import { InterviewController } from '../controllers/interview.controller';
import { authenticate } from '../middleware/auth.middleware';
import { interviewCreateRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// All interview routes require authentication
router.post('/', authenticate, interviewCreateRateLimiter, InterviewController.createInterview);
router.get('/:id', authenticate, InterviewController.getInterview);

export default router;
