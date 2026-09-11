import { prisma } from '../config/database'
import { User } from '@prisma/client'

export interface CreteUserData {
    name: string;
    email: string;
    passwordHash: string;
}

export class UserRepository {
    async findByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { email },
        });
    }

    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { id },
        });
    }

    async create(data: CreteUserData): Promise<User> {
        return prisma.user.create({
            data,
        });
    }
}