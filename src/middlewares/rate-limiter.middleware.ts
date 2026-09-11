import rateLimit from "express-rate-limit";
import { RedisStore } from 'rate-limit-redis';
import { redis } from "../config/redis";

export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        // @ts-expect-error
        sendCommand: (...args: string[]) => redis.call(...args),
        prefix: 'rl:auth:',
    }),
    message: {
        error: 'Too many requests from this IP, please try again after 15 minutes.',
    },
});

export const reservationRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
        // @ts-expect-error
        sendCommand: (...args: string[]) => redis.call(...args),
        prefix: 'rl:reservations:'
    }),
    message: {
        error: 'Too many reservation requests. Please slow down and try again shortly.',
    },
});