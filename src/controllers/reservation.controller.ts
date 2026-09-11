import { Request, Response, NextFunction } from 'express';
import { ReservationService } from '../services/reservation.service';

const reservationService = new ReservationService();

export async function createReservationHandler(req: Request, res: Response) {
  try {
    const ticketTierId = req.body.ticketTierId || req.body.tierId;
    const { quantity } = req.body;
    const userId = req.user?.id;
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized: User authentication required.' })
    }

    if (!ticketTierId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Invalid parameters for reservation. ticketTierId and a positive quantity are required.' });
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