import { rabbitMQ } from "../../config/rabbitmq";
import { prisma } from "../../config/database";
import { QUEUES, ReservationExpirationPayLoad } from "../constants";

export async function startReservationExpirationConsumer(): Promise<void> {
    const channel = await rabbitMQ.getChannel();

    await channel.prefetch(1);

    console.log(`Worker escutando mensagens na fila: [${QUEUES.RESERVATION_EXPIRATION}]`);

    await channel.consume(QUEUES.RESERVATION_EXPIRATION, async (msg) => {
        if (!msg) return;

        let payload: ReservationExpirationPayLoad;

        // 1. Barreira contra Poison Pills (JSON corrompido ou payload incompleto)
        try {
            payload = JSON.parse(msg.content.toString());

            if (!payload?.orderId || !payload?.ticketTierId || typeof payload?.quantity !== 'number') {
                console.error('[DLX Worker] Poison Pill detectada (payload incompleto). Enviando para DLQ:', msg.content.toString());
                channel.nack(msg, false, false);
                return;
            }
        } catch (parseError) {
            console.error('[DLX Worker] Poison Pill detectada (JSON corrompido). Enviando para DLQ:', parseError);
            channel.nack(msg, false, false);
            return;
        }

        // 2. Processamento da Regra de Negócio com Limite de Retentativas
        try {
            const { orderId, ticketTierId, quantity } = payload;

            console.log(`[DLX Worker] Processando possível expiração da ordem: ${orderId}`);

            await prisma.$transaction(async (tx) => {
                const order = await tx.order.findUnique({
                    where: { id: orderId },
                });

                if (!order) {
                    console.warn(`[DLX Worker] Ordem ${orderId} não encontrada no banco.`);
                    return;
                }

                if (order.status !== 'PENDING') {
                    console.log(`[DLX Worker] Ordem ${orderId} já está como [${order.status}]. Nenhuma ação de estorno necessária.`);
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

                console.log(`[DLX Worker] Ordem ${orderId} marcada como EXPIRED. ${quantity} ingresso(s) devolvido(s) ao estoque!`);
            });

            // Se o ritual teve sucesso, confirma e remove da fila
            channel.ack(msg);
        } catch (error) {
            console.error('[DLX Worker] Erro ao processar expiração da reserva:', error);

            if (msg.fields.redelivered) {
                // Já falhou anteriormente (limite de retentativas atingido) -> envia para a DLQ
                console.warn(`[DLX Worker] Limite de tentativas excedido para a ordem ${payload.orderId}. Despachando para DLQ.`);
                channel.nack(msg, false, false);
            } else {
                // Primeira falha transitória -> tenta mais uma vez
                console.log(`[DLX Worker] Primeira falha para a ordem ${payload.orderId}. Re-enfileirando para nova tentativa...`);
                channel.nack(msg, false, true);
            }
        }
    });
}