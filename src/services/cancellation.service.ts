import { OrderStatus } from "@prisma/client";
import { prisma } from "../config/database";
import { OrderRepository } from "../repositories/order.repository";

export interface CancelOrderOutput {
    orderId: string;
}

export class CancellationService {
    private orderRepo: OrderRepository;

    constructor() {
        this.orderRepo = new OrderRepository();
    }

    async execute({ orderId }: CancelOrderOutput) {
        return prisma.$transaction(async (tx) => {
            //* 1. Busca a ordem e seus itens dentro da transação
            const order = await this.orderRepo.findByIdWithItems(orderId, tx);

            if (!order) {
                throw new Error('Pedido não encontrado.');
            }

            //* 2. Idempotência: se já foi cancelado, retorna sem efeitos colaterais.
            if (order.status === OrderStatus.CANCELLED) {
                return { order, alreadyCancelled: true };
            }

            //* 3. Regras de barreira
            if (order.status === OrderStatus.CONFIRMED) {
                throw new Error('Não é possível cancelar um pedido já pago e confirmado.');
            }

            if (order.status === OrderStatus.EXPIRED) {
                throw new Error('Este pedido já expirou e seu estoque já foi liberado.');
            }

            //* 4. Devolve os ingressos ao estoque disponível (decrementa reserverdQty)
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

            //* 5. Atualiza o status do pedido para CANCELLED
            const updateOrder = await tx.order.update({
                where: { id: orderId },
                data: {
                    status: OrderStatus.CANCELLED,
                },
                include: {
                    items: true,
                },
            });

            return { order: updateOrder, alreadyCancelled: false }
        });
    }
}