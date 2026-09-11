import { Request, Response, NextFunction } from "express";
import jwt from 'jsonwebtoken';

const JWT_SECRET: string = process.env.JWT_SECRET || 'default_fallback_secret_for_dev_only';

interface TokenPayLoad {
    sub: string,
    email: string,
    iat: number,
    exp: number,
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization token is missing.' });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ error: 'Token format is invalid. Expected: Bearer <token>' });
    }

    try {
        const decode = jwt.verify(token, JWT_SECRET) as TokenPayLoad;

        req.user = {
            id: decode.sub,
            email: decode.email,
        };

        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
}