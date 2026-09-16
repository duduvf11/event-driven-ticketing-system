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
        console.warn(`[RabbitMQ] Write buffer full while publishing orders.paid for order: ${payload.orderId}`);
    } else {
        console.log(`[RabbitMQ] orders.paid event successfully published for order: ${payload.orderId}`);
    }
}