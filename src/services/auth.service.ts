import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { UserRepository } from '../repositories/user.repository';

const SALT_ROUNDS = 10;
const JWT_SECRET: string = process.env.JWT_SECRET || 'default_fallback_secret_for_dev_only';
const JWT_EXPIRES_IN_SECONDS = process.env.JWT_EXPIRES_IN
    ? Number(process.env.JWT_EXPIRES_IN) || 86400
    : 86400;

interface RegisterInput {
    name: string;
    email: string;
    password: string;
}

interface LoginInput {
    email: string;
    password: string;
}

export class AuthService {
    constructor(private userRepository: UserRepository) { }

    async register({ name, email, password }: RegisterInput) {
        const userAlreadyExists = await this.userRepository.findByEmail(email);

        if (userAlreadyExists) {
            const error = new Error('E-mail already in use.');
            (error as any).statusCode = 409;
            throw error;
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        const user = await this.userRepository.create({
            name,
            email,
            passwordHash,
        })

        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
            },
            token,
        };
    }

    async login({ email, password }: LoginInput) {
        const user = await this.userRepository.findByEmail(email);

        if (!user) {
            const error = new Error('Invalid email or password.');
            (error as any).statusCode = 401;
            throw error;
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            const error = new Error('Invalid email or password.');
            (error as any).statusCode = 401;
            throw error;
        }

        const token = this.generateToken(user.id, user.email);

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
            },
            token,
        };
    }

    private generateToken(userId: string, email: string): string {
        return jwt.sign(
            { sub: userId, email },
            JWT_SECRET,
            {
                expiresIn: JWT_EXPIRES_IN_SECONDS,
            }
        );
    }
}
