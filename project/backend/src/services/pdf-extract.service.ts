import { PDFParse, PasswordException } from 'pdf-parse';
import { resumeConfig } from '../config/resume.config';
import { AppError } from './question.service';
import { sanitizeExtractedText } from '../utils/pdf';

/**
 * PDF text extraction service.
 *
 * Library choice: pdf-parse v2.4.5
 * - Rationale: pdf-parse is the standard, cross-platform PDF parsing library for Node.js.
 *   v2.4.5 is the actively maintained pure-TypeScript release (modern ESM/CJS build with
 *   pdfjs-dist under the hood). It runs fully in-process, exposes total page count directly
 *   on TextResult (`result.total`), does not require native binaries or external utilities,
 *   and does not exhibit the legacy v1.1.1 debug-on-import side-effect.
 *
 * Worker thread vs. Promise.race timeout:
 * - LIMITATION: This implementation uses Promise.race + a timeout sentinel
 *   rather than a true worker thread. Spawning a worker thread in development
 *   with ts-node-dev (--transpile-only) requires a compiled JavaScript worker
 *   file or ts-node loader hooks which complicate local execution and testing.
 *   Promise.race protects the Express request lifecycle and HTTP handlers from
 *   hanging indefinitely, but it does NOT terminate CPU-bound synchronous loops
 *   in the current process. In a production cluster or container, process-level
 *   memory/CPU bounds or a sandboxed extraction microservice should be used for
 *   adversarial inputs.
 */

export interface PdfExtractResult {
  text: string;
  pageCount: number;
}

/**
 * Extracts text from a PDF buffer with a hard timeout.
 *
 * Maps known failure modes to typed AppError codes:
 *   PDF_ENCRYPTED      - password-protected or encrypted PDF
 *   PDF_UNREADABLE     - parse error, corrupt file, or timeout
 *   PDF_TOO_MANY_PAGES - page count exceeds RESUME_MAX_PAGES
 *   PDF_NO_TEXT        - sanitized text shorter than RESUME_MIN_TEXT_CHARS
 *
 * Text is truncated to RESUME_MAX_TEXT_CHARS after sanitization.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const timeoutMs = resumeConfig.pdfExtractTimeoutMs;

  const timeoutPromise: Promise<never> = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError(422, 'PDF_UNREADABLE', 'PDF extraction timed out'));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  let rawText = '';
  let pageCount = 0;
  let parser: PDFParse | null = null;

  try {
    const parsePromise = (async () => {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText({ pageJoiner: '' });
      return { text: result.text ?? '', total: result.total ?? 0 };
    })();

    const raw = await Promise.race([parsePromise, timeoutPromise]);
    rawText = raw.text;
    pageCount = raw.total;
  } catch (err: any) {
    if (err instanceof AppError) throw err;

    const msg: string = (err?.message ?? '').toLowerCase();
    const name: string = (err?.name ?? '').toLowerCase();
    const constructorName: string = (err?.constructor?.name ?? '').toLowerCase();

    if (
      err instanceof PasswordException ||
      name.includes('password') ||
      constructorName.includes('password') ||
      msg.includes('password') ||
      msg.includes('encrypted') ||
      msg.includes('protected') ||
      msg.includes('no password given')
    ) {
      throw new AppError(422, 'PDF_ENCRYPTED', 'PDF is password-protected or encrypted');
    }

    throw new AppError(422, 'PDF_UNREADABLE', 'PDF could not be parsed or is corrupt');
  } finally {
    if (parser && typeof (parser as any).destroy === 'function') {
      try {
        await (parser as any).destroy();
      } catch {}
    }
  }

  // Check page limit
  if (pageCount > resumeConfig.maxPages) {
    throw new AppError(
      422,
      'PDF_TOO_MANY_PAGES',
      `PDF has ${pageCount} pages; maximum allowed is ${resumeConfig.maxPages}`
    );
  }

  // Sanitize the extracted text
  const sanitized = sanitizeExtractedText(rawText);

  // Check minimum text length
  if (sanitized.length < resumeConfig.minTextChars) {
    throw new AppError(
      422,
      'PDF_NO_TEXT',
      `PDF contains too little extractable text (${sanitized.length} chars; minimum is ${resumeConfig.minTextChars})`
    );
  }

  // Truncate to maximum
  const text =
    sanitized.length > resumeConfig.maxTextChars
      ? sanitized.slice(0, resumeConfig.maxTextChars)
      : sanitized;

  return { text, pageCount };
}
