import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/config/database';
import { redis } from '../../src/config/redis';

describe('Suite 3: Order Lifecycle, Concurrency & Anti-IDOR (Business Layer)', () => {
    const suffix = Date.now();
    let userAToken: string;
    let userBToken: string;
    let userAId: string;
    let userBId: string;
    let testTierId: string;
    let testEventId: string;

    beforeAll(async () => {
        const resA = await request(app).post('/auth/register').send({
            name: 'Alex Johnson',
            email: `alex_${suffix}@example.com`,
            password: 'SecurePassword123!',
        });
        userAToken = resA.body.token;
        userAId = resA.body.user.id;

        const resB = await request(app).post('/auth/register').send({
            name: 'Bob Williams',
            email: `bob_${suffix}@example.com`,
            password: 'AnotherSecurePassword123!',
        });
        userBToken = resB.body.token;
        userBId = resB.body.user.id;

        const event = await prisma.event.create({
            data: {
                title: `Tech Innovation Summit ${suffix}`,
                location: 'Grand Convention Center',
                eventDate: new Date(Date.now() + 86400000 * 7),
            },
        });
        testEventId = event.id;

        const tier = await prisma.ticketTier.create({
            data: {
                eventId: event.id,
                name: 'VIP Keynote Pass',
                price: 150.0,
                totalQty: 10,
                reservedQty: 0,
                soldQty: 0,
            },
        });
        testTierId = tier.id;

        await redis.set(`ticket_tier:${testTierId}:available`, 10);
    });

    afterAll(async () => {
        await prisma.orderItem.deleteMany({ where: { ticketTierId: testTierId } });
        await prisma.order.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
        await prisma.ticketTier.deleteMany({ where: { id: testTierId } });
        await prisma.event.deleteMany({ where: { id: testEventId } });
        await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
        await redis.del(`ticket_tier:${testTierId}:available`);
    });

    let createdOrderId: string;

    it('should successfully reserve tickets and hold stock in PostgreSQL & Redis (201 Created)', async () => {
        const response = await request(app)
            .post('/reservations')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({
                ticketTierId: testTierId,
                quantity: 2,
            });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('order');
        expect(response.body.order.status).toBe('PENDING');
        expect(Number(response.body.order.totalAmount)).toBe(300.0);
        expect(response.body.order.userId).toBe(userAId);

        createdOrderId = response.body.order.id;

        const tierDb = await prisma.ticketTier.findUnique({ where: { id: testTierId } });
        expect(tierDb?.reservedQty).toBe(2);
    });

    it('should deny payment attempt on orders owned by another user (403 Forbidden)', async () => {
        const response = await request(app)
            .post(`/orders/${createdOrderId}/pay`)
            .set('Authorization', `Bearer ${userBToken}`)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty(
            'error',
            'Access denied. This order does not belong to you.'
        );
    });

    it('should deny cancellation attempt on orders owned by another user (403 Forbidden)', async () => {
        const response = await request(app)
            .post(`/orders/${createdOrderId}/cancel`)
            .set('Authorization', `Bearer ${userBToken}`)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body).toHaveProperty(
            'error',
            'Access denied. You do not own this order.'
        );
    });

    it('should enforce idempotency lock: accept first payment and reject duplicate (200 OK & 409 Conflict)', async () => {
        const idempotencyKey = `idemp-key-${Date.now()}`;

        const [req1, req2] = await Promise.all([
            request(app)
                .post(`/orders/${createdOrderId}/pay`)
                .set('Authorization', `Bearer ${userAToken}`)
                .set('Idempotency-Key', idempotencyKey)
                .send({}),
            request(app)
                .post(`/orders/${createdOrderId}/pay`)
                .set('Authorization', `Bearer ${userAToken}`)
                .set('Idempotency-Key', idempotencyKey)
                .send({}),
        ]);

        const statuses = [req1.status, req2.status].sort();
        expect(statuses).toEqual([200, 409]);

        const orderDb = await prisma.order.findUnique({ where: { id: createdOrderId } });
        expect(orderDb?.status).toBe('CONFIRMED');

        const tierDb = await prisma.ticketTier.findUnique({ where: { id: testTierId } });
        expect(tierDb?.reservedQty).toBe(0);
        expect(tierDb?.soldQty).toBe(2);
    });

    it('should reject cancellation of an already CONFIRMED/PAID order (400 Bad Request)', async () => {
        const response = await request(app)
            .post(`/orders/${createdOrderId}/cancel`)
            .set('Authorization', `Bearer ${userAToken}`)
            .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty(
            'error',
            'Cannot cancel an order that has already been paid and confirmed.'
        );
    });

    it('should cancel a PENDING order and restore available stock immediately in Redis & Postgres (200 OK)', async () => {
        const newRes = await request(app)
            .post('/reservations')
            .set('Authorization', `Bearer ${userAToken}`)
            .send({
                ticketTierId: testTierId,
                quantity: 3,
            });
        const orderToCancelId = newRes.body.order.id;

        const cancelRes = await request(app)
            .post(`/orders/${orderToCancelId}/cancel`)
            .set('Authorization', `Bearer ${userAToken}`)
            .send({});

        expect(cancelRes.status).toBe(200);
        expect(cancelRes.body.order.status).toBe('CANCELLED');

        const tierDb = await prisma.ticketTier.findUnique({ where: { id: testTierId } });
        expect(tierDb?.reservedQty).toBe(0);

        const payCancelledRes = await request(app)
            .post(`/orders/${orderToCancelId}/pay`)
            .set('Authorization', `Bearer ${userAToken}`)
            .send({});

        expect(payCancelledRes.status).toBe(400);
        expect(payCancelledRes.body).toHaveProperty(
            'error',
            'Order is no longer eligible for payment'
        );
    });
});
