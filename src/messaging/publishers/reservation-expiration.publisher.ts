import { rabbitMQ } from "../../config/rabbitmq";
import { EXCHANGES, ROUTING_KEYS, ReservationExpirationPayLoad } from "../constants";

export async function publishReservationExpiration(
    payload: ReservationExpirationPayLoad
): Promise<void> {
    const channel = await rabbitMQ.getChannel();

    const messageBuffer = Buffer.from(JSON.stringify(payload));

    const published = channel.publish(
        EXCHANGES.RESERVATIONS,
        ROUTING_KEYS.EXPIRATION_DELAY,
        messageBuffer,
        {
            persistent: true,
            contentType: 'application/json',
        }
    );

    if(!published) {
        console.warn(`[RabbitMQ] Buffer de escrita cheio ao agendar expiração da ordem: ${payload.orderId}`);
    } else {
        console.log(`[RabbitMQ] Expiração agendada com sucesso para a ordem: ${payload.orderId}`);
    }
}