import request from 'supertest';
import { app } from '../../src/app';

describe('Suite 1: Operational Health & Security (Network Layer)', () => {
    it('should return 200 OK with all downstream services UP', async () => {
        const response = await request(app).get('/health');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status', 'UP');
        expect(response.body.services).toEqual({
            database: 'UP',
            redis: 'UP',
            rabbitmq: 'UP',
        });
        expect(response.body).toHaveProperty('timeStamp');
    });

    it('should enforce security headers via Helmet and conceal Express identity', async () => {
        const response = await request(app).get('/health');

        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('should block requests originating from unauthorized external origins', async () => {
        const response = await request(app)
            .get('/health')
            .set('Origin', 'https://unauthorized-domain.com');

        expect(response.status).toBe(500);
        expect(response.body).toHaveProperty(
            'error',
            'Blocked by CORS policy: Origin not allowed.'
        );
    });
});