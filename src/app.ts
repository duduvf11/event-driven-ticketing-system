import express from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import { redis } from './config/redis';
import { prisma } from './config/database';
import { rabbitMQ } from './config/rabbitmq';
import { createReservationHandler } from './controllers/reservation.controller';
import { PaymentController } from './controllers/payment.controller';
import { CancellationController } from './controllers/cancellation.controller';
import { authRouter } from './routes/auth.routes';
import { authMiddleware } from './middlewares/auth.middleware';
import { authRateLimiter, reservationRateLimiter } from './middlewares/rate-limiter.middleware';

const app = express()

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS policy: Origin not allowed.'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-idempotency-key'],
    credentials: true,
    maxAge: 86400,
};

app.disable('x-powered-by');
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());

const paymentController = new PaymentController();
const cancellationController = new CancellationController();

app.get('/health', async (req, res) => {
    const health = {
        status: 'UP',
        timeStamp: new Date().toISOString(),
        services: {
            database: 'DOWN',
            redis: 'DOWN',
            rabbitmq: 'DOWN',
        },
    };

    try {
        await prisma.$queryRaw`SELECT 1`;
        health.services.database = 'UP';
    } catch (error) {
        health.services.database = 'DOWN';
    }

    try {
        const pong = await redis.ping()
        health.services.redis = pong === 'PONG' ? 'UP' : 'DOWN';
    } catch (error) {
        health.services.redis = 'DOWN';
    }

    try {
        health.services.rabbitmq = rabbitMQ.isConnected() ? 'UP' : 'DOWN';
    } catch (error) {
        health.services.rabbitmq = 'DOWN';
    }

    const isHealthy = Object.values(health.services).every((state) => state === 'UP');
    health.status = isHealthy ? 'UP' : 'DOWN';

    const statusCode = isHealthy ? 200 : 503;
    return res.status(statusCode).json(health);
});

app.use('/auth', authRateLimiter, authRouter);
app.post('/reservations', reservationRateLimiter, authMiddleware, createReservationHandler);
app.post('/orders/:id/pay', authMiddleware, paymentController.pay);
app.post('/orders/:id/cancel', authMiddleware, cancellationController.cancel);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ error: err.message || 'Internal server error.' });
});

export { app };