import path from 'path';

/**
 * Sanitizes a filename for safe storage as originalFilename metadata.
 * - Takes only the basename (strips any directory separators)
 * - Strips control characters and path separator characters (/ and \)
 * - Caps at 120 characters
 * - Falls back to "resume.pdf" if the result is empty
 *
 * NOTE: This is used only for metadata. The actual storage key is always
 * a UUID-based path, never derived from the filename.
 */
export function sanitizeFilename(name: string): string {
  // Normalize backslashes to forward slashes so basename works consistently across platforms
  const normalized = name.replace(/\\/g, '/');
  let filename = path.posix.basename(normalized);

  // Strip control characters (0x00-0x1F, 0x7F) and path separators (/ and \)
  // eslint-disable-next-line no-control-regex
  filename = filename.replace(/[\u0000-\u001F\u007F/\\]/g, '');

  // Trim whitespace
  filename = filename.trim();

  // Cap at 120 characters
  if (filename.length > 120) {
    filename = filename.slice(0, 120);
  }

  // Fallback
  if (filename === '') {
    filename = 'resume.pdf';
  }

  return filename;
}
