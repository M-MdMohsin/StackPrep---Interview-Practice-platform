import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { assertOwnsResource } from '../services/authorization.service';
import { signupSchema, loginSchema } from '../validators/auth.validator';
import { logger } from '../config/logger';

const isProduction = process.env.NODE_ENV === 'production';

export class AuthController {
  static async signup(req: Request, res: Response): Promise<void> {
    try {
      const validationResult = signupSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validationResult.error.format(),
        });
        return;
      }

      const result = await AuthService.signup(validationResult.data);

      res.cookie('accessToken', result.accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000, // 1 hour
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(201).json(result);
    } catch (error: any) {
      logger.error({ err: error }, 'Signup error');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to sign up' });
    }
  }

  static async login(req: Request, res: Response): Promise<void> {
    try {
      const validationResult = loginSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: validationResult.error.format(),
        });
        return;
      }

      const result = await AuthService.login(validationResult.data);

      res.cookie('accessToken', result.accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000, // 1 hour
      });

      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json(result);
    } catch (error: any) {
      logger.error({ err: error }, 'Login error');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to log in' });
    }
  }

  static async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.status(200).json({ message: 'Logged out successfully' });
  }

  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await AuthService.getUserById(req.user.id);
      res.status(200).json({ user });
    } catch (error: any) {
      logger.error({ err: error }, 'GetMe error');
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to get user profile' });
    }
  }

  static async getUserResource(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const rawUserId = req.params.userId;
      const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;

      if (!userId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
      }

      assertOwnsResource(req.user.id, userId, 'user resource');

      const user = await AuthService.getUserById(userId);
      res.status(200).json({ user });
    } catch (error: any) {
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({ error: error.message || 'Failed to access resource' });
    }
  }
}
