import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';
import { rabbitMQ } from '../src/config/rabbitmq';
import { setupMessagingTopology } from '../src/messaging/setup'

beforeAll(async () =>{
    await rabbitMQ.connect();
    await setupMessagingTopology();
    const rlKeys = await redis.keys('rl:*');
    if (rlKeys.length > 0) {
        await redis.del(...rlKeys);
    }
});

afterAll(async () =>{
    const rlKeys = await redis.keys('rl:*');
    if (rlKeys.length > 0) {
        await redis.del(...rlKeys);
    }
    await rabbitMQ.close();
    await redis.quit();
    await prisma.$disconnect();
});