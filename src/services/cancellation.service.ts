import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { redis } from '../config/redis';
import { OrderRepository } from '../repositories/order.repository';

export interface CancelOrderInput {
  orderId: string;
  userId: string;
}

export interface CancelOrderOutput {
  order: any;
  alreadyCancelled: boolean;
}

export class CancellationService {
  private orderRepo: OrderRepository;

  constructor() {
    this.orderRepo = new OrderRepository();
  }

  /**
   * Cancels a pending order, restores DB reserved quantity,
   * and synchronizes available inventory back to Redis.
   */
  async execute({ orderId, userId }: CancelOrderInput): Promise<CancelOrderOutput> {
    // Step 1: Database transaction ensures ACID guarantees for PostgreSQL updates
    const result = await prisma.$transaction(async (tx) => {
      const order = await this.orderRepo.findByIdWithItems(orderId, tx);

      if (!order) {
        const error: any = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }

      // Strict ownership check (prevents IDOR)
      if (order.userId !== userId) {
        const error: any = new Error('Access denied. You do not own this order.');
        error.statusCode = 403;
        throw error;
      }

      // Idempotency: if already cancelled, return gracefully without side effects
      if (order.status === OrderStatus.CANCELLED) {
        const error: any = new Error('Order is already cancelled.')
        error.statusCode = 400;
        throw error;
      }

      // Barrier rules
      if (order.status === OrderStatus.CONFIRMED || (order.status as string) === 'PAID') {
        const error: any = new Error('Cannot cancel an order that has already been paid and confirmed.');
        error.statusCode = 400;
        throw error;
      }

      const isExpiredByTime = order.expiresAt && new Date() > order.expiresAt;

      if (order.status === OrderStatus.EXPIRED || isExpiredByTime) {
        const error: any = new Error('This order has already expired and its inventory was released.');
        error.statusCode = 400;
        throw error;
      }

      // Decrement reserved quantity in Postgres
      for (const item of order.items) {
        await tx.ticketTier.update({
          where: { id: item.ticketTierId },
          data: {
            reservedQty: {
              decrement: item.quantity,
            },
          },
        });
      }

      // Update order status to CANCELLED
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.CANCELLED,
        },
        include: {
          items: true,
        },
      });

      return { order: updatedOrder, alreadyCancelled: false };
    });

    // Step 2: If the order was just cancelled, restore Redis cache availability immediately
    // Must be done AFTER the DB transaction commits successfully
    if (!result.alreadyCancelled) {
      const pipeline = redis.pipeline();

      for (const item of result.order.items) {
        const stockKey = `ticket_tier:${item.ticketTierId}:available`;
        pipeline.incrby(stockKey, item.quantity);
      }

      await pipeline.exec();
    }

    return result;
  }
}