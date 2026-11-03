/**
 * PDF magic bytes and text sanitization utilities.
 * No file I/O — pure buffer/string operations.
 */

/**
 * Returns true if the buffer starts with the PDF magic bytes "%PDF-".
 * We do NOT trust client-supplied MIME type or file extension.
 */
export function hasPdfMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  // %PDF- in ASCII: 0x25 0x50 0x44 0x46 0x2D
  return (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  );
}

/**
 * Sanitizes extracted PDF text:
 * - Removes NUL (\u0000) and other C0/C1 control characters except \n and \t
 * - Normalizes \r\n and lone \r to \n
 * - Collapses 3+ consecutive newlines to 2
 * - Collapses runs of spaces/tabs to a single space
 * - Trims leading/trailing whitespace
 *
 * Never throws — returns empty string on any unexpected input.
 */
export function sanitizeExtractedText(raw: string): string {
  try {
    let text = raw;

    // Normalize \r\n and lone \r -> \n
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove NUL and other control characters, keeping \n (0x0A) and \t (0x09)
    // Control chars: 0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F, 0x80-0x9F
    // eslint-disable-next-line no-control-regex
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/g, '');

    // Collapse 3+ consecutive newlines to 2
    text = text.replace(/\n{3,}/g, '\n\n');

    // Collapse runs of spaces and tabs (2 or more) to a single space
    // (single tabs and single spaces are preserved)
    text = text.replace(/[ \t]{2,}/g, ' ');

    // Trim
    text = text.trim();

    return text;
  } catch {
    return '';
  }
}
