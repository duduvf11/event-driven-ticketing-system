export const QUEUES = {
    RESERVATION_DELAY: 'reservations.expiration.delay',
    RESERVATION_EXPIRATION: 'reservations.expiration.process',
} as const;

export const EXCHANGES = {
    RESERVATIONS: 'reservations.exchange',
    DLX: 'reservations.dlx',
    ORDERS: 'orders.exchange',
} as const;

export const ROUTING_KEYS = {
    EXPIRATION_DELAY: 'reservation.delay',
    EXPIRATION_PROCESS: 'reservation.expired',
    ORDER_PAID: 'orders.paid',
} as const;

export interface OrderPaidPayLoad {
    orderId: string;
    userId: string;
    totalAmount: number;
    items: Array<{
        ticketTierId: string;
        quantity: number;
        unitPrice: number;
    }>;
    paidAt: string;
}

export interface ReservationExpirationPayLoad {
    orderId: string;
    ticketTierId: string;
    quantity: number;
}