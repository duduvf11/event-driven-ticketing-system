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

    // 1. Idempotência: Se já processou esta chave, retorna o pedido existente
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

    // 2. Tenta adquirir o Lock no Redis com retentativas (Backoff)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      lockToken = await DistributedLock.acquire(lockKey, 5000);
      if (lockToken) break;

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }

    if (!lockToken) {
      throw new Error('Serviço ocupado no momento devido à alta demanda. Tente novamente em instantes.');
    }

    let createdOrder;

    try {
      // 3. Transação ACID atômica no PostgreSQL protegida pelo lock
      createdOrder = await prisma.$transaction(async (tx) => {
        const tier = await this.ticketRepo.findById(ticketTierId, tx);

        if (!tier) {
          throw new Error('Lote de ingressos não encontrado.');
        }

        const availableQty = Number(tier.totalQty) - (Number(tier.reservedQty) + Number(tier.soldQty));

        if (availableQty < quantity) {
          throw new Error(`Estoque insuficiente. Quantidade disponível: ${availableQty}`);
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

    // 4. Publica o evento de expiração com o lock já liberado e a transação confirmada
    await publishReservationExpiration({
      orderId: createdOrder.id,
      ticketTierId: ticketTierId,
      quantity: quantity,
    });

    return { order: createdOrder, reused: false };
  }
}