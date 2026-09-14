import { prisma } from '../config/database';
import { Order, OrderStatus, Prisma } from '@prisma/client';

export interface CreateOrderDTO {
  userId: string;
  ticketTierId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  idempotencyKey?: string | undefined;
  expiresAt: Date;
}

export class OrderRepository {
  /**
   * Finds an order by idempotency key to prevent duplicate checkouts.
   */
  async findByIdempotencyKey(
    key: string,
    tx?: Prisma.TransactionClient
  ): Promise<Order | null> {
    const client = tx || prisma;
    return client.order.findUnique({
      where: { idempotencyKey: key },
      include: { items: true },
    });
  }

  /**
   * Creates a pending order and its associated item within a database client/transaction.
   */
  async createPendingOrder(data: CreateOrderDTO, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    return client.order.create({
      data: {
        user: {
          connect: {
            id: data.userId,
          },
        },
        totalAmount: data.totalAmount,
        status: OrderStatus.PENDING,
        idempotencyKey: data.idempotencyKey ?? null,
        expiresAt: data.expiresAt,
        items: {
          create: {
            ticketTierId: data.ticketTierId,
            quantity: data.quantity,
            unitPrice: data.unitPrice,
          },
        },
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Updates the order status and returns the order with its line items.
   * Items are included so caller services can compensate stock (e.g., cancellation rollback in Redis).
   */
  async updateStatus(
    orderId: string,
    status: OrderStatus,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || prisma;
    return client.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
      },
    });
  }

  /**
   * Retrieves an order with its line items by unique ID.
   */
  async findByIdWithItems(id: string, tx?: Prisma.TransactionClient) {
    const client = tx || prisma;
    return client.order.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });
  }
}