import 'dotenv/config';
import express from 'express';
import { redis } from './config/redis';
import { prisma } from './config/database';
import { rabbitMQ } from './config/rabbitmq';
import { createReservationHandler } from './controllers/reservation.controller';
import { setupMessagingTopology } from './messaging/setup';
import { startReservationExpirationConsumer } from './messaging/consumers/reservation-expiration.consumer';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

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

app.post('/reservations', createReservationHandler);

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