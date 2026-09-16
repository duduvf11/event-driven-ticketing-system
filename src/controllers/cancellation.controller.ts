import { Request, Response } from 'express';
import { CancellationService } from '../services/cancellation.service';

export class CancellationController {
  private cancellationService: CancellationService;

  constructor() {
    this.cancellationService = new CancellationService();
  }

  cancel = async (req: Request, res: Response): Promise<Response> => {
    try {
      const orderId = req.params.id;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized: User authentication required.',
        });
      }

      if (!orderId || typeof orderId !== 'string') {
        return res.status(400).json({
          error: 'Order ID is required and must be a valid string.',
        });
      }

      const result = await this.cancellationService.execute({ orderId, userId });

      return res.status(200).json({
        message: result.alreadyCancelled
          ? 'Order was already cancelled.'
          : 'Reservation cancelled successfully and stock released immediately.',
        order: result.order,
      });
    } catch (error: any) {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      const message = error.message || 'Internal server error while processing cancellation.';

      if (statusCode === 500) {
        console.error('[Cancellation] Error processing cancellation:', error);
      }

      return res.status(statusCode).json({ error: message });
    }
  };
}