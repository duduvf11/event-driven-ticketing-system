import { Request, Response } from 'express';
import { ReservationService } from '../services/reservation.service';

const reservationService = new ReservationService();

export async function createReservationHandler(req: Request, res: Response) {
  try {
    const ticketTierId = req.body.ticketTierId || req.body.tierId;
    const { userId, quantity } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!userId || !ticketTierId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Parâmetros inválidos para a reserva.' });
    }

    const result = await reservationService.execute({
      userId,
      ticketTierId,
      quantity: Number(quantity),
      idempotencyKey,
    });

    const statusCode = result.reused ? 200 : 201;
    return res.status(statusCode).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
}