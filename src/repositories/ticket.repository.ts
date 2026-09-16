import { prisma } from '../config/database'
import { TicketTier, Prisma } from '@prisma/client'

export class TicketRepository {
    /**
     * Finds a specific ticket tier by ID.
     */
    async findById(id: string, tx?: Prisma.TransactionClient): Promise<TicketTier | null> {
        const client = tx || prisma;
        return client.ticketTier.findUnique({
            where: { id },
        });
    }

    /**
     * Lists all events with their respective ticket tiers.
     */
    async findAllEventsWithTiers() {
        return prisma.event.findMany({
            include: {
                ticketTiers: true,
            },
        });
    }
   
    /**
     * Increments the reserved quantity (temporary reservation hold).
     */
    async incrementReservedQuantity(
        tierId: string,
        quantity: number,
        tx?: Prisma.TransactionClient
    ) {
        const client = tx || prisma;
        return client.ticketTier.update({
            where: { id: tierId },
            data: {
                reservedQty: {
                    increment: quantity,
                },
            },
        });
    }

    /**
     * Confirms purchase: decrements reserved quantity and increments sold quantity.
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

    /**
     * Releases an expired or cancelled reservation hold back to inventory.
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