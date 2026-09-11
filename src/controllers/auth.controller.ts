import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";

export class AuthController {
    constructor(private authService: AuthService) { }

    async register(req: Request, res: Response, next: NextFunction) {
        try {
            const { name, email, password } = req.body;

            if (!name || !email || !password) {
                return res.status(400).json({ error: 'Name, email and password are required.' });
            }

            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
            }

            const result = await this.authService.register({ name, email, password });
            return res.status(201).json(result);
        } catch (error: any) {
            const statusCode = error.statusCode || 500;
            return res.status(statusCode).json({ error: error.message || 'Internal server error.' });
        }
    }

    async login(req: Request, res: Response, next: NextFunction) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required.' });
            }

            const result = await this.authService.login({ email, password });
            return res.status(200).json(result);
        } catch (error: any) {
            const statusCode = error.statusCode || 500;
            return res.status(statusCode).json({ error: error.message || 'Internal server error.' });
        }
    }
}