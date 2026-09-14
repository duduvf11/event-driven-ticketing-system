import { OrderStatus } from "@prisma/client";
import { prisma } from "../config/database";
import { OrderRepository } from "../repositories/order.repository";
import { publishOrderPaid } from "../messaging/publishers/order-paid.publisher";
import { redis } from "../config/redis";

export interface ProcessPaymentInput {
    orderId: string;
    userId: string;
    idempotencyKey?: string | undefined;
}

export class PaymentService {
    private orderRepo: OrderRepository;

    constructor() {
        this.orderRepo = new OrderRepository();
    }

    async execute({ orderId, userId, idempotencyKey }: ProcessPaymentInput) {
        const lockKey = idempotencyKey
            ? `idempotency:order:pay:${idempotencyKey}`
            : `lock:order:pay:${orderId}`;

        const acquired = await redis.set(lockKey, 'PROCESSING', 'EX', 60, 'NX');

        if (!acquired) {
            const error: any = new Error('Payment is already being processed or duplicate request.');
            error.statusCode = 409;
            throw error;
        }

        try {
            const updatedOrder = await prisma.$transaction(async (tx) => {
                const order = await this.orderRepo.findByIdWithItems(orderId, tx);

                if (!order) {
                    const error: any = new Error('Pedido não encontrado.');
                    error.statusCode = 404;
                    throw error;
                }

                if (order.userId !== userId) {
                    const error: any = new Error('Acesso negado. Este pedido não pertence a você.');
                    error.statusCode = 403;
                    throw error;
                }

                if (order.status === OrderStatus.CONFIRMED || (order.status as string) === 'PAID') {
                    const error: any = new Error('Order is already paid');
                    error.statusCode = 400;
                    throw error;
                }

                const isExpiredByTime = order.expiresAt && new Date() > order.expiresAt;

                if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.EXPIRED || isExpiredByTime) {
                    const error: any = new Error('Order is no longer eligible for payment');
                    error.statusCode = 400;
                    throw error;
                }

                for (const item of order.items) {
                    await tx.ticketTier.update({
                        where: { id: item.ticketTierId },
                        data: {
                            reservedQty: {
                                decrement: item.quantity,
                            },
                            soldQty: {
                                increment: item.quantity,
                            },
                        },
                    });
                }

                const updatedOrder = await tx.order.update({
                    where: { id: orderId },
                    data: {
                        status: OrderStatus.CONFIRMED,
                    },
                    include: {
                        items: true,
                    },
                });

                return updatedOrder
            });

            await publishOrderPaid({
                orderId: updatedOrder.id,
                userId: updatedOrder.userId,
                totalAmount: Number(updatedOrder.totalAmount),
                items: updatedOrder.items.map(item => ({
                    ticketTierId: item.ticketTierId,
                    quantity: item.quantity,
                    unitPrice: Number(item.unitPrice),
                })),
                paidAt: new Date().toISOString(),
            });

            if (!idempotencyKey) {
                await redis.del(lockKey);
            }

            return { order: updatedOrder };
        } catch (error) {
            await redis.del(lockKey);
            throw error;
        }
    }
}