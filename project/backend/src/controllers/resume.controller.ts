import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { ResumeService } from '../services/resume.service';
import { AppError } from '../services/question.service';
import { hasPdfMagicBytes } from '../utils/pdf';
import { resumeConfig } from '../config/resume.config';
import { logger } from '../config/logger';

// ─── Multer configuration ─────────────────────────────────────────────────────

/**
 * Multer instance with memoryStorage, fileSize limit, and files:1 limit.
 * Only the field "resume" is accepted.
 */
export const resumeMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: resumeConfig.maxBytes,
    files: 1,
  },
});

/**
 * Multer middleware for the "resume" field.
 * Wraps multer's single() as Express middleware and maps errors to AppErrors.
 */
export function multerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const handler = resumeMulter.single('resume');

  handler(req, res, (err: any) => {
    if (!err) {
      return next();
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File exceeds the maximum allowed size', code: 'FILE_TOO_LARGE' });
      return;
    }

    if (
      err.code === 'LIMIT_UNEXPECTED_FILE' ||
      err.code === 'LIMIT_FILE_COUNT' ||
      err.message?.includes('Unexpected field')
    ) {
      res.status(400).json({ error: 'Expected exactly one file in field "resume"', code: 'INVALID_UPLOAD' });
      return;
    }

    // Propagate other multer errors as 400 INVALID_UPLOAD
    res.status(400).json({ error: err.message ?? 'Invalid upload', code: 'INVALID_UPLOAD' });
    return;
  });
}

// ─── UUID validation ──────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(err: any, res: Response): void {
  if (err instanceof AppError) {
    if (err.headers) {
      for (const [key, val] of Object.entries(err.headers)) {
        res.setHeader(key, val);
      }
    }
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.statusCode).json(body);
    return;
  }
  logger.error({ err }, 'Unexpected resume controller error');
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
}

// ─── Controller ───────────────────────────────────────────────────────────────

export class ResumeController {
  /**
   * POST /api/resumes
   * Upload a resume PDF. Multer runs before this handler.
   */
  static async uploadResume(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      // Multer has already enforced fileSize and files:1
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
        return;
      }

      const buffer = req.file.buffer;
      const clientFilename = req.file.originalname ?? 'resume.pdf';

      // Magic-byte check: reject non-PDFs regardless of declared MIME type or extension
      if (!hasPdfMagicBytes(buffer)) {
        res.status(415).json({ error: 'File must be a PDF', code: 'UNSUPPORTED_FILE_TYPE' });
        return;
      }

      const result = await ResumeService.uploadResume(req.user.id, buffer, clientFilename);

      const statusCode = result.reused ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (err: any) {
      handleError(err, res);
    }
  }

  /**
   * GET /api/resumes
   * List all resumes owned by the authenticated user.
   */
  static async listResumes(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const resumes = await ResumeService.listResumes(req.user.id);
      res.status(200).json({ resumes });
    } catch (err: any) {
      handleError(err, res);
    }
  }

  /**
   * GET /api/resumes/:id
   * Get a specific resume by ID (ownership-checked).
   */
  static async getResume(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!isValidUuid(id)) {
        res.status(400).json({ error: 'Invalid resume ID format', code: 'INVALID_RESUME_ID' });
        return;
      }

      const resume = await ResumeService.getResume(id, req.user.id);
      res.status(200).json({ resume });
    } catch (err: any) {
      handleError(err, res);
    }
  }

  /**
   * DELETE /api/resumes/:id
   * Delete a resume (ownership-checked). Deletes file first, then DB row.
   */
  static async deleteResume(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      const rawId = req.params.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;

      if (!isValidUuid(id)) {
        res.status(400).json({ error: 'Invalid resume ID format', code: 'INVALID_RESUME_ID' });
        return;
      }

      await ResumeService.deleteResume(id, req.user.id);
      res.status(204).send();
    } catch (err: any) {
      handleError(err, res);
    }
  }
}
