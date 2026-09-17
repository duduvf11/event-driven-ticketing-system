import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/config/database';

describe('Suite 2: Authentication & Identity (Auth Layer)', () => {
    const uniqueSuffix = Date.now();
    const testUser = {
        name: 'Alex Johnson',
        email: `alex.johnson_${uniqueSuffix}@example.com`,
        password: 'SecurePassword123!',
    };

    afterAll(async () => {
        await prisma.user.deleteMany({
            where: { email: { contains: `alex.johnson_${uniqueSuffix}` } },
        });
    });

    it('should successfully register a new user with hashed password (201 Created)', async () => {
        const response = await request(app)
            .post('/auth/register')
            .send(testUser);

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('user');
        expect(response.body.user).toHaveProperty('id');
        expect(response.body.user.email).toBe(testUser.email);
        expect(response.body.user.name).toBe(testUser.name);
        expect(response.body.user).not.toHaveProperty('password');
        expect(response.body.user).not.toHaveProperty('passwordHash');
        expect(response.body).toHaveProperty('token');
    });

    it('should reject registration if email is already taken (409 Conflict)', async () => {
        const response = await request(app)
            .post('/auth/register')
            .send(testUser);

        expect(response.status).toBe(409);
        expect(response.body).toHaveProperty('error', 'E-mail already in use.');
    });

    it('should authenticate valid credentials and issue a signed JWT token (200 OK)', async () => {
        const response = await request(app)
            .post('/auth/login')
            .send({
                email: testUser.email,
                password: testUser.password,
            });
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('token');
        expect(typeof response.body.token).toBe('string');
        expect(response.body.user.email).toBe(testUser.email);
    });

    it('should deny authentication with incorrect password (401 Unauthorized)', async () => {
        const response = await request(app)
            .post('/auth/login')
            .send({
                email: testUser.email,
                password: 'WrongPassword123!',
            });
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error', 'Invalid email or password.');
    });

    it('should block access to protected endpoints when token is missing (401 Unauthorized)', async () => {
        const response = await request(app)
            .post('/reservations')
            .send({
                ticketTierId: 'fake-tier-uuid',
                quantity: 1,
            });
        expect(response.status).toBe(401);
        expect(response.body).toHaveProperty('error', 'Authorization token is missing.');
    });
});