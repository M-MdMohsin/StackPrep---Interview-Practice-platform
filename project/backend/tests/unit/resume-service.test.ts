import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResumeService } from '../../src/services/resume.service';
import { storage } from '../../src/services/storage';
import { prisma } from '../../src/config/prisma';
import * as pdfExtractModule from '../../src/services/pdf-extract.service';
import * as redisLockModule from '../../src/utils/redisLock';
import { redis } from '../../src/config/redis';
import { AppError } from '../../src/services/question.service';

describe('ResumeService - Unit Tests with Mocks', () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const resumeId = '22222222-2222-2222-2222-222222222222';
  // Valid PDF header "%PDF-"
  const validPdfBuffer = Buffer.from('%PDF-1.4 sample content with enough text for testing purposes here');

  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure redis looks ready
    Object.defineProperty(redis, 'status', { value: 'ready', configurable: true });
    vi.spyOn(redisLockModule, 'acquireLock').mockResolvedValue('mock-token');
    vi.spyOn(redisLockModule, 'releaseLock').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('DB insert failure compensation', () => {
    it('deletes the stored file when DB insert fails', async () => {
      // 1. Existing check returns null (not duplicate)
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue(null as any);
      // 2. Count check returns 0 (below max limit)
      vi.spyOn(prisma.resume, 'count').mockResolvedValue(0);
      // 3. Extract text succeeds
      vi.spyOn(pdfExtractModule, 'extractPdfText').mockResolvedValue({
        text: 'Sample valid extracted text exceeding minimum length requirement easily',
        pageCount: 1,
      });
      // 4. Storage put succeeds
      const putSpy = vi.spyOn(storage, 'put').mockResolvedValue(undefined);
      // 5. Storage delete spy for compensation
      const deleteSpy = vi.spyOn(storage, 'delete').mockResolvedValue(undefined);
      // 6. DB create FAILS
      const dbError = new Error('Database connection failed during insert');
      vi.spyOn(prisma.resume, 'create').mockRejectedValue(dbError);

      await expect(
        ResumeService.uploadResume(userId, validPdfBuffer, 'resume.pdf')
      ).rejects.toThrow('Database connection failed during insert');

      // Verify storage.put was called
      expect(putSpy).toHaveBeenCalledTimes(1);
      const storedKey = putSpy.mock.calls[0][0];
      expect(storedKey).toMatch(/^resumes\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);

      // Verify compensation: storage.delete was called with the exact stored key
      expect(deleteSpy).toHaveBeenCalledWith(storedKey);
    });
  });

  describe('Delete resume with storage failure', () => {
    it('throws 500 STORAGE_ERROR and does NOT delete DB row when storage.delete fails with EACCES', async () => {
      // 1. Resume exists in DB and belongs to user
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        fileUrl: `resumes/${userId}/${resumeId}.pdf`,
      } as any);

      // 2. Storage delete fails with EACCES
      const eaccesError = new Error('Permission denied');
      (eaccesError as any).code = 'EACCES';
      vi.spyOn(storage, 'delete').mockRejectedValue(eaccesError);

      // 3. Prisma resume delete spy
      const prismaDeleteSpy = vi.spyOn(prisma.resume, 'delete').mockResolvedValue({} as any);

      await expect(ResumeService.deleteResume(resumeId, userId)).rejects.toMatchObject({
        statusCode: 500,
        code: 'STORAGE_ERROR',
      });

      // The database row MUST NOT be deleted so user can retry and no orphan is created
      expect(prismaDeleteSpy).not.toHaveBeenCalled();
    });

    it('deletes DB row when storage.delete succeeds', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue({
        id: resumeId,
        fileUrl: `resumes/${userId}/${resumeId}.pdf`,
      } as any);
      vi.spyOn(storage, 'delete').mockResolvedValue(undefined);
      const prismaDeleteSpy = vi.spyOn(prisma.resume, 'delete').mockResolvedValue({} as any);

      await expect(ResumeService.deleteResume(resumeId, userId)).resolves.toBeUndefined();

      expect(prismaDeleteSpy).toHaveBeenCalledWith({ where: { id: resumeId } });
    });
  });

  describe('Encrypted PDF failure handling (mocked extractor)', () => {
    it('throws 422 PDF_ENCRYPTED when extraction detects encryption, leaving 0 files and 0 rows', async () => {
      vi.spyOn(prisma.resume, 'findFirst').mockResolvedValue(null as any);
      vi.spyOn(prisma.resume, 'count').mockResolvedValue(0);

      // Mock extractor throwing PDF_ENCRYPTED
      vi.spyOn(pdfExtractModule, 'extractPdfText').mockRejectedValue(
        new AppError(422, 'PDF_ENCRYPTED', 'PDF is password-protected or encrypted')
      );

      const putSpy = vi.spyOn(storage, 'put');
      const createSpy = vi.spyOn(prisma.resume, 'create');

      await expect(
        ResumeService.uploadResume(userId, validPdfBuffer, 'encrypted.pdf')
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'PDF_ENCRYPTED',
      });

      // No file should be stored and no DB record created
      expect(putSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
