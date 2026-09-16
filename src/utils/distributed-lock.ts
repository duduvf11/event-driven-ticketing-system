import { randomUUID } from "crypto";
import { redis } from '../config/redis';

export class DistributedLock {
    /** 
     * Attempts to acquire a distributed lock in Redis.
     * @param key Unique identifying key for the resource (e.g., lock:ticket_tier:UUID)
     * @param ttlMs Lock time-to-live in milliseconds (default: 5000ms)
     * @returns The lock token on success, or null if the resource is currently locked.
     */
    static async acquire(key: string, ttlMs: number = 5000): Promise<string | null> {
        const lockToken = randomUUID();

        // 'PX': TTL expiration in ms | 'NX': set only if key does not exist
        const result = await redis.set(key, lockToken, 'PX', ttlMs, 'NX');
        return result === 'OK' ? lockToken : null;
    }

    /**
     * Atomically releases the distributed lock via Lua script only if the token matches.
     * @param key Unique identifying key for the resource
     * @param lockToken Token returned upon acquisition
     * @returns boolean indicating whether the lock was successfully released
     */
    static async release(key: string, lockToken: string): Promise<boolean> {
        const luaScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        const result = await redis.eval(luaScript, 1, key, lockToken);
        return result === 1;
    }
}