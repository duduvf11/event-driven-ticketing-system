import { prisma } from '../config/database'
import { TicketTier, Prisma } from '@prisma/client'

export class TicketRepository {
    /*
     * Busca um lote específico pelo ID 
     */
    async findById(id: string, tx?: Prisma.TransactionClient): Promise<TicketTier | null> {
        const client = tx || prisma;
        return client.ticketTier.findUnique({
            where: { id },
        });
    }

    /*
     * Lista todos os eventos com seus respectivos lotes de ingressos
     */
    async findAllEventsWithTiers() {
        return prisma.event.findMany({
            include: {
                ticketTiers: true,
            },
        });
    }
   
    /*
     * Incrementa a quantidade reservada (reserva temporária)
     */
    async incrementReservedQuantity(
        tierId: string,
        quantity: number,
        tx?:  Prisma.TransactionClient
    ) {
        const client = tx || prisma;
        return client.ticketTier.update ({
            where: { id: tierId },
            data: {
                reservedQty: {
                    increment: quantity,
                },
            },
        });
    }

    /*
     * Confirma a compra: decrementa a reserva e incrementa o total vendido
     */
    async confirmSoldQuantity(
        tierId: string,
        quantity: number,
        tx?: Prisma.TransactionClient
    ) {
        const client = tx || prisma;
        return client.ticketTier.update({
            where: { id: tierId },
            data: {
                reservedQty: {
                    decrement: quantity,
                },
                soldQty: {
                    increment: quantity,
                },
            },
        });
    }

    /*
     * Libera uma reserva expirada ou cancelada
     */
    async releaseReservation(
        tierId: string,
        quantity: number,
        tx?: Prisma.TransactionClient
    ) {
        const client = tx || prisma;
        return client.ticketTier.update({
            where: { id: tierId },
            data: {
               reservedQty: {
                    decrement: quantity,
               },
            },
        });
    }
}