import { rabbitMQ } from "../../config/rabbitmq";
import { prisma } from "../../config/database"
import { QUEUES, ReservationExpirationPayLoad } from "../constants";

export async function startReservationExpirationConsumer(): Promise<void> {
    const channel = rabbitMQ.getChannel();

    (await channel).prefetch(1)

    console.log(`Worker escutando mensagens na fila: [${QUEUES.RESERVATION_EXPIRATION}]`);

    (await channel).consume(QUEUES.RESERVATION_EXPIRATION, async (msg) => {
        if (!msg) return;

        try {
            const payload: ReservationExpirationPayLoad = JSON.parse(msg.content.toString());
            const { orderId, ticketTierId, quantity } = payload;

            console.log(`[DLX Worker] Processando possível expiração da ordem: ${orderId}`);

            await prisma.$transaction(async (tx) => {
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                });

                if (!order) {
                    console.warn(`[DLX Worker] Ordem ${orderId} não encontrado no banco.`);
                    return;
                }

                if (order.status !== 'PENDING') {
                    console.log(`[DLX Worker] Ordem ${orderId} já está como [${order.status}]. Nenhuma ação de estorno necessária.`)
                    return;
                }

                await tx.order.update({
                    where: { id: orderId },
                    data: { status: 'EXPIRED' },
                });

                await tx.ticketTier.update({
                    where: { id: ticketTierId },
                    data: {
                        reservedQty: {
                            decrement: quantity,
                        },
                    },
                });

                console.log(`[DLX Worker] Ordem ${orderId} marcada como EXPIRED. ${quantity} ingresso(s) devolvido(s) ao estoque!`)
            });
        } catch (error) {
            console.error('[DLX Worker] Erro ao processar reserva:', error);
            (await channel).nack(msg, false, true);
        }
    });
}