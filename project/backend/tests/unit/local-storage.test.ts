import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { LocalDiskStorage } from '../../src/services/storage/local-disk.storage';

// Create a fresh temp directory for each test
let tmpDir: string;
let storage: LocalDiskStorage;

// A valid storage key for testing
const VALID_KEY = 'resumes/12345678-1234-1234-1234-123456789012/abcdef01-abcd-abcd-abcd-abcdef012345.pdf';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  storage = new LocalDiskStorage(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('LocalDiskStorage - key validation', () => {
  it('rejects a path traversal key (../x)', async () => {
    await expect(storage.put('../x', Buffer.from('data'))).rejects.toThrow();
  });

  it('rejects an absolute key path', async () => {
    await expect(storage.put('/etc/passwd', Buffer.from('data'))).rejects.toThrow();
  });

  it('rejects a key that does not match the expected pattern', async () => {
    await expect(storage.put('resumes/not-uuid/file.pdf', Buffer.from('data'))).rejects.toThrow();
  });

  it('rejects a key with wrong file extension', async () => {
    const badKey = 'resumes/12345678-1234-1234-1234-123456789012/abcdef01-abcd-abcd-abcd-abcdef012345.txt';
    await expect(storage.put(badKey, Buffer.from('data'))).rejects.toThrow();
  });

  it('rejects exists() with path traversal', async () => {
    await expect(storage.exists('../secret')).rejects.toThrow();
  });

  it('rejects delete() with path traversal', async () => {
    await expect(storage.delete('../secret')).rejects.toThrow();
  });
});

describe('LocalDiskStorage - put()', () => {
  it('stores a file and it is readable', async () => {
    const content = Buffer.from('%PDF-test-content');
    await storage.put(VALID_KEY, content);

    const resolvedPath = path.join(tmpDir, VALID_KEY);
    const stored = fs.readFileSync(resolvedPath);
    expect(stored).toEqual(content);
  });

  it('fails with wx flag when putting the same key twice', async () => {
    const content = Buffer.from('%PDF-first-write');
    await storage.put(VALID_KEY, content);

    // Second write to the same key should fail (wx flag)
    await expect(storage.put(VALID_KEY, Buffer.from('%PDF-second'))).rejects.toThrow();
  });

  it('creates parent directories that did not exist', async () => {
    await storage.put(VALID_KEY, Buffer.from('%PDF-data'));
    const resolvedPath = path.join(tmpDir, VALID_KEY);
    expect(fs.existsSync(resolvedPath)).toBe(true);
  });
});

describe('LocalDiskStorage - exists()', () => {
  it('returns false for a key that has not been stored', async () => {
    expect(await storage.exists(VALID_KEY)).toBe(false);
  });

  it('returns true after a file has been stored', async () => {
    await storage.put(VALID_KEY, Buffer.from('%PDF-data'));
    expect(await storage.exists(VALID_KEY)).toBe(true);
  });
});

describe('LocalDiskStorage - delete()', () => {
  it('deletes an existing file successfully', async () => {
    await storage.put(VALID_KEY, Buffer.from('%PDF-data'));
    await storage.delete(VALID_KEY);
    expect(await storage.exists(VALID_KEY)).toBe(false);
  });

  it('treats deletion of a missing key as a no-op (ENOENT success)', async () => {
    // Should not throw
    await expect(storage.delete(VALID_KEY)).resolves.toBeUndefined();
  });

  it('rethrows non-ENOENT errors', async () => {
    // Write a file, then make its parent directory unreadable to simulate an error
    // This test only runs meaningfully on non-Windows (skip on Windows)
    if (process.platform === 'win32') {
      // On Windows, permission tricks are unreliable; skip
      return;
    }

    await storage.put(VALID_KEY, Buffer.from('%PDF-data'));
    const resolvedPath = path.join(tmpDir, VALID_KEY);
    const dir = path.dirname(resolvedPath);

    // Make parent dir non-writable
    fs.chmodSync(dir, 0o444);
    try {
      await expect(storage.delete(VALID_KEY)).rejects.toThrow();
    } finally {
      // Restore permissions
      fs.chmodSync(dir, 0o755);
    }
  });
});
