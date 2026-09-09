export const QUEUES = {
    RESERVATION_DELAY: 'reservations.expiration.delay',
    RESERVATION_EXPIRATION: 'reservations.expiration.process',
} as const;

export const EXCHANGES = {
    RESERVATIONS: 'reservations.exchange',
    DLX: 'reservations.dlx',
} as const;

export const ROUTING_KEYS = {
    EXPIRATION_DELAY: 'reservation.delay',
    EXPIRATION_PROCESS: 'reservation.expired',
} as const;

export interface ReservationExpirationPayLoad {
    orderId: string,
    ticketTierId: string,
    quantity: number,
}