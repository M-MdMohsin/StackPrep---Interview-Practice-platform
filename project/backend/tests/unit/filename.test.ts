import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../../src/utils/filename';

describe('sanitizeFilename', () => {
  it('strips path traversal components from "../../etc/passwd.pdf"', () => {
    const result = sanitizeFilename('../../etc/passwd.pdf');
    expect(result).toBe('passwd.pdf');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('strips backslash path components from "a\\\\b.pdf"', () => {
    const result = sanitizeFilename('a\\b.pdf');
    expect(result).not.toContain('\\');
    expect(result).not.toContain('/');
    expect(result).toBe('b.pdf');
  });

  it('strips control characters from filenames', () => {
    const input = 'resume\u0001\u0007\u001F.pdf';
    const result = sanitizeFilename(input);
    expect(result).not.toMatch(/[\u0000-\u001F]/);
    expect(result).toBe('resume.pdf');
  });

  it('falls back to "resume.pdf" for an empty string', () => {
    expect(sanitizeFilename('')).toBe('resume.pdf');
  });

  it('falls back to "resume.pdf" when only path separators remain', () => {
    // After basename + stripping, could be empty
    expect(sanitizeFilename('/')).toBe('resume.pdf');
  });

  it('caps names longer than 120 characters', () => {
    const long = 'a'.repeat(200) + '.pdf';
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('handles a 500-char name by capping at 120', () => {
    const long = 'b'.repeat(500);
    const result = sanitizeFilename(long);
    expect(result.length).toBe(120);
  });

  it('preserves a normal filename unchanged', () => {
    expect(sanitizeFilename('my-resume_2024.pdf')).toBe('my-resume_2024.pdf');
  });

  it('uses basename only (strips leading path)', () => {
    const result = sanitizeFilename('/home/user/documents/resume.pdf');
    // path.basename will give "resume.pdf", then stripping / leaves "resume.pdf"
    expect(result).toBe('resume.pdf');
  });

  it('handles Windows-style absolute paths by taking basename', () => {
    const result = sanitizeFilename('C:\\Users\\user\\resume.pdf');
    // path.basename on 'C:\\...' gives 'resume.pdf' on Windows
    // After stripping backslashes: should not contain backslash
    expect(result).not.toContain('\\');
  });

  it('handles a filename with only control characters as fallback', () => {
    const input = '\u0001\u0002\u0003';
    expect(sanitizeFilename(input)).toBe('resume.pdf');
  });
});
