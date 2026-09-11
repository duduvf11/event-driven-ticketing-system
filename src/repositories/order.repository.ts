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
     * Busca pedido por chave de idempotência para evitar compras duplicadas
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
     * Cria o pedido e o item associado dentro de uma transação
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
     * Atualiza o status de um pedido existente
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
        });
    }

    /**
     * Permite a leitura dos itens dentro ou fora de uma transação 
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