import { prisma } from '../config/prisma';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { acquireLock, releaseLock } from '../utils/redisLock';
import { hasPdfMagicBytes } from '../utils/pdf';
import { sanitizeFilename } from '../utils/filename';
import { extractPdfText } from './pdf-extract.service';
import { storage } from './storage';
import { resumeConfig } from '../config/resume.config';
import { AppError } from './question.service';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { Prisma } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResumeParsedDto {
  skills: string[];
  projects: string[];
  experience: string[];
  education: string[];
  technologies: string[];
}

export interface ResumeDto {
  id: string;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  pageCount: number | null;
  analysisStatus: string;
  analysisError: string | null;
  guardrailFlagged: boolean;
  createdAt: Date;
  analyzedAt: Date | null;
  parsed: ResumeParsedDto | null;
}

export interface UploadResumeResult {
  resume: ResumeDto;
  reused: boolean;
}

// ─── DTO Mapper ───────────────────────────────────────────────────────────────

/**
 * Maps a Prisma Resume row to a safe ResumeDto.
 * NEVER includes extractedText (rawText), fileUrl, contentHash, or internal fields.
 * Populates parsed with { skills, projects, experience, education, technologies }
 * when analysisStatus === 'COMPLETED', otherwise null.
 */
export function toResumeDto(resume: {
  id: string;
  originalFilename: string | null;
  fileSizeBytes: number | null;
  pageCount: number | null;
  analysisStatus: string;
  analysisError: string | null;
  guardrailFlagged: boolean;
  createdAt: Date;
  analyzedAt: Date | null;
  parsedData?: any;
  parsedEducation?: any;
  parsedTechnologies?: any;
}): ResumeDto {
  let parsed: ResumeParsedDto | null = null;

  if (resume.analysisStatus === 'COMPLETED') {
    const data = (resume.parsedData as any) ?? {};
    parsed = {
      skills: Array.isArray(data.skills) ? data.skills : [],
      projects: Array.isArray(data.projects) ? data.projects : [],
      experience: Array.isArray(data.experience) ? data.experience : [],
      education: Array.isArray(resume.parsedEducation)
        ? (resume.parsedEducation as string[])
        : Array.isArray(data.education)
        ? data.education
        : [],
      technologies: Array.isArray(resume.parsedTechnologies)
        ? (resume.parsedTechnologies as string[])
        : Array.isArray(data.technologies)
        ? data.technologies
        : [],
    };
  }

  return {
    id: resume.id,
    originalFilename: resume.originalFilename,
    fileSizeBytes: resume.fileSizeBytes,
    pageCount: resume.pageCount,
    analysisStatus: resume.analysisStatus,
    analysisError: resume.analysisError,
    guardrailFlagged: resume.guardrailFlagged,
    createdAt: resume.createdAt,
    analyzedAt: resume.analyzedAt,
    parsed,
  };
}

// ─── Select clause (safe fields only) ────────────────────────────────────────

export const RESUME_DTO_SELECT = {
  id: true,
  originalFilename: true,
  fileSizeBytes: true,
  pageCount: true,
  analysisStatus: true,
  analysisError: true,
  guardrailFlagged: true,
  createdAt: true,
  analyzedAt: true,
  parsedData: true,
  parsedEducation: true,
  parsedTechnologies: true,
  // explicitly exclude: rawText, fileUrl, contentHash, fileName, fileSize
} as const;

// ─── Service ─────────────────────────────────────────────────────────────────

export class ResumeService {
  /**
   * Uploads a resume, deduplicates by content hash, enforces per-user limits.
   * Returns {resume, reused} — 201 if new, 200 if identical file already exists.
   */
  static async uploadResume(
    userId: string,
    buffer: Buffer,
    clientFilename: string
  ): Promise<UploadResumeResult> {
    const startMs = Date.now();

    // 1. Magic bytes check (UNSUPPORTED_FILE_TYPE) is done in the controller
    //    before acquiring a lock. Confirmed again here for defense-in-depth.
    if (!hasPdfMagicBytes(buffer)) {
      throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'File must be a PDF');
    }

    // 2. Acquire Redis lock to prevent concurrent uploads from the same user
    let lockToken: string | null = null;
    const lockKey = `lock:resume-upload:${userId}`;

    try {
      if (redis.status !== 'ready') {
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
      }
      lockToken = await acquireLock(lockKey, resumeConfig.uploadLockTtlSeconds);
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable (Redis unreachable)');
    }

    if (!lockToken) {
      throw new AppError(409, 'UPLOAD_IN_PROGRESS', 'An upload is already in progress for this account', undefined, {
        'Retry-After': 2,
      });
    }

    try {
      // 3a. SHA-256 of the buffer for deduplication
      const contentHash = createHash('sha256').update(buffer).digest('hex');

      // 3b. Check if this user already has a resume with the same content hash
      const existing = await prisma.resume.findFirst({
        where: { userId, contentHash },
        select: RESUME_DTO_SELECT,
      });

      if (existing) {
        const durationMs = Date.now() - startMs;
        logger.info(
          { userId, resumeId: existing.id, reused: true, pageCount: existing.pageCount, bytes: buffer.length, durationMs },
          'Resume upload: reused (content hash match)'
        );
        return { resume: toResumeDto(existing), reused: true };
      }

      // 3c. Check per-user resume count limit
      const resumeCount = await prisma.resume.count({ where: { userId } });
      if (resumeCount >= resumeConfig.maxResumesPerUser) {
        throw new AppError(
          409,
          'RESUME_LIMIT_REACHED',
          `You have reached the maximum number of resumes (${resumeConfig.maxResumesPerUser})`
        );
      }

      // 3d. Extract PDF text (throws typed AppError on failure)
      const { text, pageCount } = await extractPdfText(buffer);

      // 3e. Generate IDs and storage key
      const resumeId = uuidv4();
      const storageKey = `resumes/${userId}/${resumeId}.pdf`;

      // 3f. Store the file
      try {
        await storage.put(storageKey, buffer);
      } catch (err: any) {
        throw new AppError(500, 'STORAGE_ERROR', 'Failed to store uploaded file');
      }

      // 3g. Insert the Resume row. On failure, delete the stored file (compensation).
      let resume: ResumeDto;
      try {
        const row = await prisma.resume.create({
          data: {
            id: resumeId,
            userId,
            // Legacy column — kept for backwards compat; use originalFilename for display
            fileName: sanitizeFilename(clientFilename),
            // Opaque storage key (not a URL)
            fileUrl: storageKey,
            rawText: text,
            originalFilename: sanitizeFilename(clientFilename),
            fileSizeBytes: buffer.length,
            pageCount,
            contentHash,
            analysisStatus: 'PENDING',
          },
          select: RESUME_DTO_SELECT,
        });
        resume = toResumeDto(row);
      } catch (err: any) {
        // Compensation: delete stored file best-effort
        await storage.delete(storageKey).catch(() => {});

        // Handle race condition: another concurrent request inserted same contentHash
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Re-fetch the existing resume for this user+contentHash
          const raceExisting = await prisma.resume.findFirst({
            where: { userId, contentHash },
            select: RESUME_DTO_SELECT,
          });
          if (raceExisting) {
            const durationMs = Date.now() - startMs;
            logger.info(
              { userId, resumeId: raceExisting.id, reused: true, pageCount: raceExisting.pageCount, bytes: buffer.length, durationMs },
              'Resume upload: reused (race condition - unique constraint hit)'
            );
            return { resume: toResumeDto(raceExisting), reused: true };
          }
        }

        throw err;
      }

      const durationMs = Date.now() - startMs;
      logger.info(
        { userId, resumeId, reused: false, pageCount, bytes: buffer.length, durationMs },
        'Resume upload: new resume stored'
      );

      return { resume, reused: false };
    } finally {
      if (lockToken) {
        try {
          await releaseLock(lockKey, lockToken);
        } catch (err) {
          logger.error({ err }, 'Failed to release resume upload Redis lock');
        }
      }
    }
  }

  /**
   * Lists all resumes owned by the given user, newest first.
   */
  static async listResumes(userId: string): Promise<ResumeDto[]> {
    const rows = await prisma.resume.findMany({
      where: { userId },
      select: RESUME_DTO_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toResumeDto);
  }

  /**
   * Gets a single resume by ID.
   * Returns 404 for both "not found" and "belongs to another user" (Step 5 convention).
   */
  static async getResume(resumeId: string, userId: string): Promise<ResumeDto> {
    const row = await prisma.resume.findFirst({
      where: { id: resumeId, userId },
      select: RESUME_DTO_SELECT,
    });

    if (!row) {
      throw new AppError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    }

    return toResumeDto(row);
  }

  /**
   * Deletes a resume by ID.
   * Deletes the stored file FIRST. If file deletion fails (non-ENOENT),
   * returns 500 and keeps the database row so the user can retry.
   * If file deletion succeeds (or file is already gone), deletes the DB row.
   * Returns 404 for not-found or unauthorized (Step 5 convention).
   */
  static async deleteResume(resumeId: string, userId: string): Promise<void> {
    // Load the resume with the storage key (fileUrl) — scoped to this user
    const row = await prisma.resume.findFirst({
      where: { id: resumeId, userId },
      select: { id: true, fileUrl: true },
    });

    if (!row) {
      throw new AppError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    }

    // Delete the stored file FIRST
    if (row.fileUrl) {
      try {
        await storage.delete(row.fileUrl);
      } catch (err: any) {
        // If file deletion fails (not ENOENT — that's already treated as success in storage),
        // keep the DB row and return 500 so the user can retry
        logger.error({ err, resumeId, userId }, 'Failed to delete resume file from storage');
        throw new AppError(500, 'STORAGE_ERROR', 'Failed to delete stored file');
      }
    }

    // Delete the database row (Prisma cascade handles future ResumeChunk rows)
    await prisma.resume.delete({ where: { id: resumeId } });

    logger.info({ resumeId, userId }, 'Resume deleted');
  }
}
