import 'dotenv/config';
import { app } from './app';
import { redis } from './config/redis';
import { prisma } from './config/database';
import { rabbitMQ } from './config/rabbitmq';
import { setupMessagingTopology } from './messaging/setup';
import { startReservationExpirationConsumer } from './messaging/consumers/reservation-expiration.consumer';

const port = Number(process.env.PORT) || 3000;

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