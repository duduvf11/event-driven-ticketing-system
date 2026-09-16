import { rabbitMQ, RABBITMQ_CONFIG } from "../config/rabbitmq";
import { EXCHANGES, QUEUES, ROUTING_KEYS } from "./constants";

export async function setupMessagingTopology(): Promise<void> {
    const channel = await rabbitMQ.getChannel();

    await channel.assertExchange(EXCHANGES.RESERVATIONS, 'direct', { durable: true });
    await channel.assertExchange(EXCHANGES.DLX, 'direct', { durable: true });
    await channel.assertExchange(EXCHANGES.RESERVATIONS_DLX, 'direct', { durable: true });
    await channel.assertExchange(EXCHANGES.ORDERS, 'topic', { durable: true });

    await channel.assertQueue(QUEUES.RESERVATION_DLQ, { durable: true });
    await channel.bindQueue(
        QUEUES.RESERVATION_DLQ,
        EXCHANGES.RESERVATIONS_DLX,
        ROUTING_KEYS.EXPIRATION_DLQ
    );

    await channel.assertQueue(QUEUES.RESERVATION_EXPIRATION, { 
        durable: true, 
        deadLetterExchange: EXCHANGES.RESERVATIONS_DLX, 
        deadLetterRoutingKey: ROUTING_KEYS.EXPIRATION_DLQ, 
    });
    
    await channel.bindQueue(
        QUEUES.RESERVATION_EXPIRATION,
        EXCHANGES.DLX,
        ROUTING_KEYS.EXPIRATION_PROCESS
    )

    await channel.assertQueue(QUEUES.RESERVATION_DELAY, {
        durable: true,
        deadLetterExchange: EXCHANGES.DLX,
        deadLetterRoutingKey: ROUTING_KEYS.EXPIRATION_PROCESS,
        messageTtl: RABBITMQ_CONFIG.reservationTtlMs,
    });

    await channel.bindQueue(
        QUEUES.RESERVATION_DELAY,
        EXCHANGES.RESERVATIONS,
        ROUTING_KEYS.EXPIRATION_DELAY
    );

    console.log(`[RabbitMQ] Messaging topology successfully declared (TTL: ${RABBITMQ_CONFIG.reservationTtlMs}ms).`);
}