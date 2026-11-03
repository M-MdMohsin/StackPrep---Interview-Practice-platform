import fs from 'fs';
import path from 'path';
import { StorageProvider } from './storage.types';

/**
 * Security: all storage keys MUST match this pattern.
 * Prevents path traversal and enforces a predictable key structure.
 */
const VALID_KEY_PATTERN = /^resumes\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;

export class LocalDiskStorage implements StorageProvider {
  private readonly root: string;

  constructor(rootDir: string) {
    // Resolve to absolute path at construction time
    this.root = path.resolve(rootDir);
  }

  /**
   * Validates a storage key and resolves it to an absolute path.
   * Throws if the key doesn't match the expected pattern or resolves outside root (path traversal guard).
   */
  private resolveSafe(key: string): string {
    if (!VALID_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid storage key format: ${key}`);
    }
    const resolved = path.resolve(this.root, key);
    // Guard against path traversal: resolved path must start with root + separator
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new Error(`Path traversal detected for key: ${key}`);
    }
    return resolved;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const filePath = this.resolveSafe(key);
    const dir = path.dirname(filePath);

    // Create parent directories (recursive, no-op if they exist)
    await fs.promises.mkdir(dir, { recursive: true });

    // Write with 'wx' flag: fails if file already exists
    // mode 0o600: owner read+write only
    await fs.promises.writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveSafe(key);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: any) {
      // Treat "file not found" as success; rethrow everything else
      if (err.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolveSafe(key);
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
