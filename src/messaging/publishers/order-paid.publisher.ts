import { rabbitMQ } from "../../config/rabbitmq";
import { EXCHANGES, ROUTING_KEYS, OrderPaidPayLoad } from "../constants";

export async function publishOrderPaid(payload: OrderPaidPayLoad): Promise<void> {
    const channel = await rabbitMQ.getChannel();
    const messageBuffer = Buffer.from(JSON.stringify(payload));

    const published = channel.publish(
        EXCHANGES.ORDERS,
        ROUTING_KEYS.ORDER_PAID,
        messageBuffer,
        {
            persistent: true,
            contentType: 'application/json',
        }
    );

    if (!published) {
        console.warn(`[RabbitMQ] Buffer cheio ao publicar orders.paid para ordem: ${payload.orderId}`);
    } else {
        console.log(`[RabbitMQ] Evento orders.paid publicado com sucesso para ordem: ${payload.orderId}`);
    }
}