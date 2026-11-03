import { resumeConfig } from '../../config/resume.config';
import { LocalDiskStorage } from './local-disk.storage';
import { StorageProvider } from './storage.types';

/**
 * Selects the active storage provider based on STORAGE_DRIVER env var.
 * Currently only 'local' is supported.
 * This is the single factory for all resume storage — no other module should
 * instantiate a storage provider directly.
 */
function createStorageProvider(): StorageProvider {
  const driver = resumeConfig.storageDriver;

  switch (driver) {
    case 'local':
    default:
      return new LocalDiskStorage(resumeConfig.uploadDir);
  }
}

export const storage: StorageProvider = createStorageProvider();

export { StorageProvider } from './storage.types';
