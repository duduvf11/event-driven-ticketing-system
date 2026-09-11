import { Request, Response } from 'express';
import { CancellationService } from "../services/cancellation.service";

export class CancellationController {
    private cancellationService: CancellationService;

    constructor() {
        this.cancellationService = new CancellationService()
    }

    cancel = async (req: Request, res: Response): Promise<Response> => {
        try {
            const orderId = req.params.id;

            if (!orderId || typeof orderId !== 'string') {
                return res.status(400).json({ error: 'O ID do pedido é obrigatório e deve ser uma string válida.' })
            }

            const result = await this.cancellationService.execute({ orderId });

            return res.status(200).json({
                message: result.alreadyCancelled
                    ? 'Pedido já se encontrava cancelado.'
                    : 'Reserva cancelada com sucesso e estoque liberado imediatamente.',
                order: result.order,
            });
        } catch (error: any) {
            if (
                error.message.includes('confirmado') ||
                error.message.includes('expirou')
            ) {
                return res.status(409).json({ error: error.message });
            }

            if (error.message.includes('não encontrado')) {
                return res.status(404).json({ error: error.message });
            }

            console.error('Erro ao cancelar reserva:', error);
            return res.status(500).json({ error: 'Erro interno ao processar cancelamento.' });
        }
    }
}