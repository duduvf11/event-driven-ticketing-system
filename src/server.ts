import 'dotenv/config';
import express from 'express';
import { redis } from './config/redis';
import { prisma } from './config/database';
import { rabbitMQ } from './config/rabbitmq';
import { createReservationHandler } from './controllers/reservation.controller';
import { PaymentController } from './controllers/payment.controller';
import { setupMessagingTopology } from './messaging/setup';
import { startReservationExpirationConsumer } from './messaging/consumers/reservation-expiration.consumer';
import { CancellationController } from './controllers/cancellation.controller';
import { authRouter } from './routes/auth.routes';
import { authMiddleware } from './middlewares/auth.middleware';
import { authRateLimiter, reservationRateLimiter } from './middlewares/rate-limiter.middleware';

const app = express();
const port = Number(process.env.PORT) || 3000;

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

let server: ReturnType<typeof app.listen>;
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Graceful Shutdown] ${signal} signal received. Starting graceful shutdown sequence...`);

  const forceExitTimeout = setTimeout(() => {
    console.error('[Graceful Shutdown] 10s timeout exceeded! Forcing process termination.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  try {
    if (server && server.listening) {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') {
            console.warn('[Graceful Shutdown] Warning closing HTTP server:', err.message);
          } else {
            console.log('[Graceful Shutdown] HTTP server closed successfully.');
          }
          resolve();
        });
      });
    } else {
      console.log('[Graceful Shutdown] HTTP server was already closed or not listening.');
    }

    await rabbitMQ.close();
    console.log('[Graceful Shutdown] RabbitMQ connection and channel closed.');

    await redis.quit();
    console.log('[Graceful Shutdown] Redis connection closed.');

    await prisma.$disconnect();
    console.log('[Graceful Shutdown] PostgreSQL (Prisma) connection disconnected.');

    clearTimeout(forceExitTimeout);
    console.log('[Graceful Shutdown] Graceful shutdown completed cleanly.');
    process.exit(0);
  } catch (error) {
    console.error('[Graceful Shutdown] Error encountered during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

async function bootstrap() {
  try {
    await rabbitMQ.connect();
    await setupMessagingTopology();
    await startReservationExpirationConsumer();

    server = app.listen(port, () => {
      console.log(`HTTP Server running on: http://localhost:${port}`);
      console.log(`Health Check available on: http://localhost:${port}/health`);
    });
  } catch (error) {
    console.error('Failed to bootstrap server dependencies:', error);
    process.exit(1);
  }
}
bootstrap();