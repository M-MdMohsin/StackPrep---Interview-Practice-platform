/**
 * Resume upload configuration.
 * All values are read from environment variables with safe defaults.
 * Throws a startup error if any required value is invalid.
 */

function requirePositiveInt(envVar: string, defaultVal: number): number {
  const raw = process.env[envVar];
  const value = raw !== undefined ? parseInt(raw, 10) : defaultVal;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `[resume.config] ${envVar} must be a positive integer, got: ${JSON.stringify(raw ?? defaultVal)}`
    );
  }
  return value;
}

function requireNonEmptyString(envVar: string, defaultVal: string): string {
  const value = process.env[envVar] ?? defaultVal;
  if (!value || value.trim() === '') {
    throw new Error(`[resume.config] ${envVar} must be a non-empty string`);
  }
  return value;
}

export const resumeConfig = {
  /** Maximum file size in bytes for uploaded resumes */
  maxBytes: requirePositiveInt('RESUME_MAX_BYTES', 5_242_880),

  /** Maximum number of pages allowed in an uploaded PDF */
  maxPages: requirePositiveInt('RESUME_MAX_PAGES', 10),

  /** Minimum number of characters required in extracted text */
  minTextChars: requirePositiveInt('RESUME_MIN_TEXT_CHARS', 200),

  /** Maximum number of characters to store from extracted text */
  maxTextChars: requirePositiveInt('RESUME_MAX_TEXT_CHARS', 50_000),

  /** Maximum number of resumes a single user may have */
  maxResumesPerUser: requirePositiveInt('MAX_RESUMES_PER_USER', 3),

  /** Rate limit: uploads per hour per user */
  uploadLimitPerHour: requirePositiveInt('RESUME_UPLOAD_LIMIT_PER_HOUR', 10),

  /** Timeout in ms for PDF text extraction */
  pdfExtractTimeoutMs: requirePositiveInt('PDF_EXTRACT_TIMEOUT_MS', 15_000),

  /** TTL in seconds for the upload Redis lock */
  uploadLockTtlSeconds: requirePositiveInt('UPLOAD_LOCK_TTL_SECONDS', 60),

  /** Directory where uploaded files are stored locally */
  uploadDir: requireNonEmptyString('UPLOAD_DIR', './uploads'),

  /** Storage driver: 'local' is the only supported value in Part 1 */
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
} as const;
