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
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized: User authentication required.' });
            }

            if (!orderId || typeof orderId !== 'string') {
                return res.status(400).json({ error: 'O ID do pedido é obrigatório.' });
            }


            const result = await this.paymentService.execute({ orderId, userId });
            
            return res.status(200).json({
                message: 'Pagamento confirmado com sucesso!',
                order: result.order,
            });
            } catch (error: any) {
                const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 400;
                const message = error?.message || 'Erro ao processar pagamento.';
                if (statusCode === 500) {
                    console.error('Erro interno ao processar pagamento:', error);
                    return res.status(500).json({ error: 'Erro interno ao processar o pagamento.' });
                }
                return res.status(statusCode).json({ error: message });
            }
    };
}