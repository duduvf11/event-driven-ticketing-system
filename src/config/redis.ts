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
    console.log("Conexão com Redis estabelecida com sucesso via URL:", redisUrl);
});

redis.on('ready', () => {
  console.log('Redis pronto para receber comandos.');
});

redis.on('error', (err) =>{
    console.error('Erro na conexão com Redis:', err.message)
});