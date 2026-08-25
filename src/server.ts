import 'dotenv/config';
import express, {type Request, type Response} from 'express';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
    });
});

app.listen(port, () =>{
    console.log(`Servidor HTTP rodando em: http://localhost:${port}`);
  console.log(`Health Check disponível em: http://localhost:${port}/health`);
})