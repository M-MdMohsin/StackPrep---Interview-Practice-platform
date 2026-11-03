/**
 * StorageProvider interface.
 * All resume file I/O must go through this interface.
 * No other file may import 'fs' for resume file operations.
 */
export interface StorageProvider {
  /**
   * Store a file buffer under the given key.
   * Throws if the key already exists (write mode 'wx').
   * @param key - Opaque storage key, e.g. "resumes/{userId}/{resumeId}.pdf"
   * @param buffer - File content
   */
  put(key: string, buffer: Buffer): Promise<void>;

  /**
   * Delete the file at the given key.
   * Treats ENOENT (file not found) as success.
   * Re-throws any other error.
   */
  delete(key: string): Promise<void>;

  /**
   * Check whether a file exists at the given key.
   */
  exists(key: string): Promise<boolean>;
}
