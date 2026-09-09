import { OrderStatus } from "@prisma/client";
import { prisma } from "../config/database";
import { OrderRepository } from "../repositories/order.repository";

export interface ProcessPaymentInput {
    orderId: string;
}

export class PaymentService {
    private orderRepo: OrderRepository;

    constructor() {
        this.orderRepo = new OrderRepository();
    }

    async execute({ orderId }: ProcessPaymentInput) {
        return prisma.$transaction(async (tx) => {
            const order = await this.orderRepo.findByIdWithItems(orderId, tx);

            if (!order) {
                throw new Error('Pedido não encontrado.');
            }

            if (order.status === 'CONFIRMED') {
                return { order, alreadyPaid: true }
            }

            if (order.status === 'EXPIRED') {
                throw new Error('Este pedido expirou e não pode mais ser pago.')
            }

            if (order.status === 'CANCELLED') {
                throw new Error('Este pedido foi cancelado.')
            }

            if (order.expiresAt && new Date() > order.expiresAt) {
                throw new Error('O tempo limite para pagamento deste pedido expirou.')
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
                        }
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

            return { order: updatedOrder, alreadyPaid: false };
        });
    }
}