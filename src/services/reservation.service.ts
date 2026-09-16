import { prisma } from '../config/database';
import { TicketRepository } from '../repositories/ticket.repository';
import { OrderRepository } from '../repositories/order.repository';
import { DistributedLock } from '../utils/distributed-lock';
import { publishReservationExpiration } from '../messaging/publishers/reservation-expiration.publisher';
import { RABBITMQ_CONFIG } from '../config/rabbitmq';

export interface ReservedTicketInput {
  userId: string;
  ticketTierId: string;
  quantity: number;
  idempotencyKey?: string | undefined;
}

export class ReservationService {
  private ticketRepo: TicketRepository;
  private orderRepo: OrderRepository;

  constructor() {
    this.ticketRepo = new TicketRepository();
    this.orderRepo = new OrderRepository();
  }

  async execute(input: ReservedTicketInput) {
    const { userId, ticketTierId, quantity, idempotencyKey } = input;

    // 1. Idempotency: If this key has already been processed, return the existing order
    if (idempotencyKey) {
      const existingOrder = await this.orderRepo.findByIdempotencyKey(idempotencyKey);
      if (existingOrder) {
        return { order: existingOrder, reused: true };
      }
    }

    const lockKey = `lock:ticket_tier:${ticketTierId}`;
    const maxRetries = 15;
    const retryDelayMs = 80;
    let lockToken: string | null = null;

    // 2. Attempt to acquire Redis distributed lock with retry backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lockToken = await DistributedLock.acquire(lockKey, 5000);
      if (lockToken) break;

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }

    if (!lockToken) {
      throw new Error('Service temporarily busy due to high demand. Please try again shortly.');
    }

    let createdOrder;

    try {
      // 3. PostgreSQL atomic ACID transaction guarded by the distributed lock
      createdOrder = await prisma.$transaction(async (tx) => {
        const tier = await this.ticketRepo.findById(ticketTierId, tx);

        if (!tier) {
          throw new Error('Ticket tier not found.');
        }

        const availableQty = Number(tier.totalQty) - (Number(tier.reservedQty) + Number(tier.soldQty));

        if (availableQty < quantity) {
          throw new Error(`Insufficient stock. Available quantity: ${availableQty}`);
        }

        await this.ticketRepo.incrementReservedQuantity(ticketTierId, quantity, tx);

        const expiresAt = new Date(Date.now() + RABBITMQ_CONFIG.reservationTtlMs);
        const totalAmount = Number(tier.price) * quantity;

        const order = await this.orderRepo.createPendingOrder(
          {
            userId,
            ticketTierId,
            quantity,
            unitPrice: Number(tier.price),
            totalAmount,
            idempotencyKey,
            expiresAt,
          },
          tx
        );

        return order;
      });
    } finally {
      await DistributedLock.release(lockKey, lockToken);
    }

    // 4. Publish expiration event after releasing the lock and committing transaction
    await publishReservationExpiration({
      orderId: createdOrder.id,
      ticketTierId: ticketTierId,
      quantity: quantity,
    });

    return { order: createdOrder, reused: false };
  }
}