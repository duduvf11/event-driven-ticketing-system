import { rabbitMQ } from "../../config/rabbitmq";
import { prisma } from "../../config/database";
import { redis } from "../../config/redis";
import { QUEUES, ReservationExpirationPayLoad } from "../constants";

export async function startReservationExpirationConsumer(): Promise<void> {
    const channel = await rabbitMQ.getChannel();

    await channel.prefetch(1);

    console.log(`[Worker] Listening for messages on queue: [${QUEUES.RESERVATION_EXPIRATION}]`);

    await channel.consume(QUEUES.RESERVATION_EXPIRATION, async (msg) => {
        if (!msg) return;

        let payload: ReservationExpirationPayLoad;

        // 1. Barrier against Poison Pills (malformed JSON or incomplete payload)
        try {
            payload = JSON.parse(msg.content.toString());

            if (!payload?.orderId || !payload?.ticketTierId || typeof payload?.quantity !== 'number') {
                console.error('[DLX Worker] Poison Pill detected (incomplete payload). Routing to DLQ:', msg.content.toString());
                channel.nack(msg, false, false);
                return;
            }
        } catch (parseError) {
            console.error('[DLX Worker] Poison Pill detected (malformed JSON). Routing to DLQ:', parseError);
            channel.nack(msg, false, false);
            return;
        }

        // 2. Business logic processing with retry limits
        try {
            const { orderId, ticketTierId, quantity } = payload;

            console.log(`[DLX Worker] Processing potential expiration for order: ${orderId}`);

            let wasExpired = false;

            await prisma.$transaction(async (tx) => {
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                });

                if (!order) {
                    console.warn(`[DLX Worker] Order ${orderId} not found in database.`);
                    return;
                }

                if (order.status !== 'PENDING') {
                    console.log(`[DLX Worker] Order ${orderId} is already [${order.status}]. No rollback required.`);
                    return;
                }

                await tx.order.update({
                    where: { id: orderId },
                    data: { status: 'EXPIRED' },
                });

                await tx.ticketTier.update({
                    where: { id: ticketTierId },
                    data: {
                        reservedQty: {
                            decrement: quantity,
                        },
                    },
                });

                wasExpired = true;
                console.log(`[DLX Worker] Order ${orderId} marked as EXPIRED. ${quantity} ticket(s) released back to inventory.`);
            });

            if (wasExpired) {
                await redis.incrby(`ticket_tier:${ticketTierId}:available`, quantity);
            }

            // Acknowledge and remove from queue upon successful processing
            channel.ack(msg);
        } catch (error) {
            console.error('[DLX Worker] Error processing reservation expiration:', error);

            if (msg.fields.redelivered) {
                // Previously failed (retry limit reached) -> dispatch to DLQ
                console.warn(`[DLX Worker] Retry limit exceeded for order ${payload.orderId}. Dispatching to DLQ.`);
                channel.nack(msg, false, false);
            } else {
                // Transient failure on initial delivery -> re-queue for single retry
                console.log(`[DLX Worker] First transient failure for order ${payload.orderId}. Re-queuing for retry...`);
                channel.nack(msg, false, true);
            }
        }
    });
}