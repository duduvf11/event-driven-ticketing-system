import { Request, Response } from 'express';
import { PaymentService } from '../services/payment.service';

export class PaymentController {
    private paymentService: PaymentService;

    constructor() {
        this.paymentService = new PaymentService();
    }

    pay = async (req: Request, res: Response): Promise<Response> => {
        try {
            const { id: orderId } = req.params;

            if (!orderId || typeof orderId !== 'string') {
                return res.status(400).json({ error: 'O ID do pedido é obrigatório.' })
            }

            const result = await this.paymentService.execute({ orderId });

            return res.status(200).json({
                message: result.alreadyPaid
                    ? 'Pedido já havia sido pago anteriormente.'
                    : 'Pagamento confirmado com sucesso!',
                order: result.order,
            });
        } catch (error: any) {
            const message = error?.message || '';

            if (message.includes('expirou') || message.includes('cancelado')) {
                return res.status(409).json({ error: message });
            }

            if (message.includes('não encontrado')) {
                return res.status(404).json({ error: message });
            }

            console.error('Erro ao processar pagamento:', error);
            return res.status(500).json({ error: 'Erro interno ao processar o pagamento.' });
        }
    };
}