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
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisPing = await redis.ping();
    const rabbitChannel = await rabbitMQ.getChannel();

    return res.status(200).json({
      status: 'ok',
      database: 'connected',
      redis: redisPing === 'PONG' ? 'connected' : 'unreachable',
      rabbitmq: rabbitChannel ? 'connected' : 'unreachable',
    });
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Service dependency failure',
    });
  }
});

app.use('/auth', authRateLimiter, authRouter);

app.post('/reservations', reservationRateLimiter, authMiddleware, createReservationHandler);
app.post('/orders/:id/pay', paymentController.pay);
app.post('/orders/:id/cancel', cancellationController.cancel);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({ error: err.message || 'Internal server error.' });
});

async function bootstrap() {
  try {
    await rabbitMQ.connect();
    await setupMessagingTopology();
    await startReservationExpirationConsumer();

    app.listen(port, () => {
      console.log(`Servidor HTTP rodando em: http://localhost:${port}`);
      console.log(`Health Check disponível em: http://localhost:${port}/health`);
    });
  } catch (error) {
    console.error('Falha ao iniciar dependências do servidor:', error);
    process.exit(1);
  }
}

bootstrap();