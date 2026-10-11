import { Router } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import interviewRoutes from './interview.routes';
import questionRoutes from './question.routes';
import answerRoutes from './answer.routes';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.get('/me', authenticate, AuthController.getMe);
router.use('/interviews', interviewRoutes);
router.use('/interviews/:id/questions', questionRoutes);
router.use('/questions/:questionId/answers', answerRoutes);

export default router;
