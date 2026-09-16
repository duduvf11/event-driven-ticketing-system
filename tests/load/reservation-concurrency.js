import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics';

const successfulReservations = new Counter('successful_reservations');
const rejectedReservations = new Counter('rejected_reservations');
const otherErrors = new Counter('other_errors');

export const options = {
    scenarios: {
        ticket_rush: {
            executor: 'per-vu-iterations',
            vus: 50,
            iterations: 1,
            maxDuration: '30s',
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.9'],
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
const TARGET_TIER_ID = __ENV.TIER_ID

export default function () {
    if (!TARGET_TIER_ID) {
        throw new Error('TIER_ID was not defined! Pass via: -e TIER_ID="<uuid>"');
    }

    const uniqueUserId = `user-vu-${__VU}-${Date.now()}`;
    const idempotencyKey = `idemp-${__VU}-${Date.now()}`;

    const payload = JSON.stringify({
        userId: uniqueUserId,
        ticketTierId: TARGET_TIER_ID,
        tierId: TARGET_TIER_ID,
        quantity: 1,
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': idempotencyKey,
        },
    };

    const res = http.post(`${BASE_URL}/reservations`, payload, params);

    if (res.status === 201) {
        successfulReservations.add(1);
        check(res, {
            'status is 201': (r) => r.status === 201,
        });
    } else if (res.status === 400 || res.status === 409) {
        rejectedReservations.add(1);
        check(res, {
            'status is sold-out/conflict': (r) => r.status === 400 || r.status === 409,
        });
    } else {
        otherErrors.add(1);
        console.error(`Unexpected status [${res.status}]: ${res.body}`);
    }
}