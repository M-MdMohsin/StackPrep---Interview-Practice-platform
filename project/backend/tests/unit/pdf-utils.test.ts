import { describe, it, expect } from 'vitest';
import { hasPdfMagicBytes, sanitizeExtractedText } from '../../src/utils/pdf';

describe('hasPdfMagicBytes', () => {
  it('returns true for a valid PDF header', () => {
    const buf = Buffer.from('%PDF-1.4 ...');
    expect(hasPdfMagicBytes(buf)).toBe(true);
  });

  it('returns false for an empty buffer', () => {
    expect(hasPdfMagicBytes(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for a buffer shorter than 5 bytes', () => {
    expect(hasPdfMagicBytes(Buffer.from('%PDF'))).toBe(false);
  });

  it('returns false when the magic bytes are shifted (start at byte 1)', () => {
    // Prepend a NUL byte so %PDF- starts at offset 1, not 0
    const shifted = Buffer.concat([Buffer.from([0x00]), Buffer.from('%PDF-1.4')]);
    expect(hasPdfMagicBytes(shifted)).toBe(false);
  });

  it('returns false for a ZIP header (PK\\x03\\x04)', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(hasPdfMagicBytes(zip)).toBe(false);
  });

  it('returns false for a PNG header', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hasPdfMagicBytes(png)).toBe(false);
  });

  it('returns false for a plain text file', () => {
    expect(hasPdfMagicBytes(Buffer.from('Hello, world!'))).toBe(false);
  });

  it('returns false for MZ (Windows PE) header', () => {
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    expect(hasPdfMagicBytes(mz)).toBe(false);
  });
});

describe('sanitizeExtractedText', () => {
  it('removes NUL bytes', () => {
    const input = 'Hello\u0000World';
    expect(sanitizeExtractedText(input)).toBe('HelloWorld');
  });

  it('removes other control characters except \\n and \\t', () => {
    // \u0001 (SOH), \u0007 (BEL), \u000E (SO) should all be removed
    const input = 'A\u0001B\u0007C\u000ED';
    expect(sanitizeExtractedText(input)).toBe('ABCD');
  });

  it('preserves newlines', () => {
    const input = 'line1\nline2\nline3';
    expect(sanitizeExtractedText(input)).toBe('line1\nline2\nline3');
  });

  it('preserves tabs', () => {
    const input = 'col1\tcol2\tcol3';
    expect(sanitizeExtractedText(input)).toBe('col1\tcol2\tcol3');
  });

  it('normalizes \\r\\n to \\n', () => {
    const input = 'line1\r\nline2\r\nline3';
    expect(sanitizeExtractedText(input)).toBe('line1\nline2\nline3');
  });

  it('normalizes lone \\r to \\n', () => {
    const input = 'line1\rline2';
    expect(sanitizeExtractedText(input)).toBe('line1\nline2');
  });

  it('collapses 3+ consecutive newlines to 2', () => {
    const input = 'A\n\n\n\n\nB';
    expect(sanitizeExtractedText(input)).toBe('A\n\nB');
  });

  it('collapses runs of spaces to a single space', () => {
    const input = 'word1   word2     word3';
    expect(sanitizeExtractedText(input)).toBe('word1 word2 word3');
  });

  it('collapses runs of tabs to a single space', () => {
    const input = 'col1\t\t\tcol2';
    expect(sanitizeExtractedText(input)).toBe('col1 col2');
  });

  it('trims leading and trailing whitespace', () => {
    const input = '  \n  Hello World  \n  ';
    expect(sanitizeExtractedText(input)).toBe('Hello World');
  });

  it('handles empty string without throwing', () => {
    expect(sanitizeExtractedText('')).toBe('');
  });

  it('removes C1 control characters (\\u0080-\\u009F)', () => {
    const input = 'Hello\u0080World';
    expect(sanitizeExtractedText(input)).toBe('HelloWorld');
  });

  it('handles a realistic resume text snippet correctly', () => {
    const input = 'John Doe\r\n\r\nExperience\r\n\r\n  Software Engineer  \r\n  2020 - Present\u0000\r\n\r\n\r\nSkills\r\nTypeScript, Node.js';
    const result = sanitizeExtractedText(input);
    expect(result).toContain('John Doe');
    expect(result).toContain('Software Engineer');
    expect(result).toContain('TypeScript');
    // No NUL
    expect(result).not.toContain('\u0000');
    // No triple newlines
    expect(result).not.toMatch(/\n{3,}/);
    // No \r
    expect(result).not.toContain('\r');
  });
});
