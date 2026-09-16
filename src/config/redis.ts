import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

redis.on('connect', () => {
    console.log('[Redis] Connected successfully via URL:', redisUrl);
});

redis.on('ready', () => {
    console.log('[Redis] Ready to accept commands.');
});

redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});