import { redis } from '../config/redis';
import { randomBytes } from 'crypto';

const memoryLocks = new Map<string, string>();

export async function acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
  const token = randomBytes(16).toString('hex');
  try {
    if (redis.status === 'ready') {
      const result = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
      return result === 'OK' ? token : null;
    }
  } catch {}
  
  if (memoryLocks.has(key)) return null;
  memoryLocks.set(key, token);
  setTimeout(() => { if (memoryLocks.get(key) === token) memoryLocks.delete(key); }, ttlSeconds * 1000);
  return token;
}

const RELEASE_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

export async function releaseLock(key: string, token: string): Promise<void> {
  try {
    if (redis.status === 'ready') {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
      return;
    }
  } catch {}
  if (memoryLocks.get(key) === token) memoryLocks.delete(key);
}
