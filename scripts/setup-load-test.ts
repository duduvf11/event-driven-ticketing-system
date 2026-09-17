import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_change_in_production';
const NUM_USERS = 100;

async function main() {
  console.log('='.repeat(60));
  console.log(' PREPARING LOAD TEST ENVIRONMENT (PHASE 14 - K6)');
  console.log('='.repeat(60));

  // 1. Find or create the target Event and TicketTier
  let event = await prisma.event.findFirst({
    where: { title: 'Flash Sale Concurrency Summit' },
  });

  if (!event) {
    event = await prisma.event.create({
      data: {
        title: 'Flash Sale Concurrency Summit',
        description: 'High-concurrency load testing event for k6 stress test',
        location: 'Virtual Convention Center',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }

  let tier = await prisma.ticketTier.findFirst({
    where: { eventId: event.id, name: 'Flash Sale Limited Tier' },
  });

  if (!tier) {
    tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Flash Sale Limited Tier',
        price: 50.0,
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  } else {
    // Clean up previous orders associated with this tier to ensure a clean slate
    const orderItems = await prisma.orderItem.findMany({
      where: { ticketTierId: tier.id },
      select: { orderId: true },
    });
    const orderIds = orderItems.map((oi) => oi.orderId);

    if (orderIds.length > 0) {
      await prisma.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await prisma.order.deleteMany({
        where: { id: { in: orderIds } },
      });
    }

    // Reset tier counters strictly to 10 total, 0 reserved, 0 sold
    tier = await prisma.ticketTier.update({
      where: { id: tier.id },
      data: {
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  }

  // 2. Clear Redis lock and initialize Redis available balance
  const lockKey = `lock:ticket_tier:${tier.id}`;
  const stockKey = `ticket_tier:${tier.id}:available`;
  await redis.del(lockKey);
  await redis.set(stockKey, tier.totalQty);

  // Clear any residual rate limit keys
  const rlKeys = await redis.keys('rl:*');
  if (rlKeys.length > 0) {
    await redis.del(...rlKeys);
  }

  // 3. Seed pool of Virtual Users (VUs) and generate valid JWT tokens
  console.log(`[Setup] Provisioning ${NUM_USERS} Virtual Users and JWT access tokens...`);
  const passwordHash = await bcrypt.hash('LoadTestSecurePass123!', 8);
  const tokens: string[] = [];

  for (let i = 1; i <= NUM_USERS; i++) {
    const email = `vu_user_${i}@loadtest.example.com`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        name: `Virtual User ${i}`,
        email,
        passwordHash,
      },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    tokens.push(token);
  }

  // 4. Save test-data.json for k6 consumption
  const testData = {
    tierId: tier.id,
    totalQty: tier.totalQty,
    tokens,
  };

  const dataFilePath = path.join(__dirname, '../tests/load/test-data.json');
  fs.writeFileSync(dataFilePath, JSON.stringify(testData, null, 2), 'utf-8');
  console.log(`[Setup] test-data.json generated at: ${dataFilePath}`);

  // 5. Update .env LOAD_TEST_TIER_ID if present
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf-8');
    if (envContent.includes('LOAD_TEST_TIER_ID=')) {
      envContent = envContent.replace(
        /LOAD_TEST_TIER_ID=.*/,
        `LOAD_TEST_TIER_ID="${tier.id}"`
      );
    } else {
      envContent += `\nLOAD_TEST_TIER_ID="${tier.id}"\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`[Setup] .env updated with LOAD_TEST_TIER_ID="${tier.id}"`);
  }

  console.log('='.repeat(60));
  console.log(`TIER_ID:          ${tier.id}`);
  console.log(`TIER_NAME:        ${tier.name}`);
  console.log(`TOTAL_QTY:        ${tier.totalQty}`);
  console.log(`RESERVED_QTY:     ${tier.reservedQty}`);
  console.log(`SOLD_QTY:         ${tier.soldQty}`);
  console.log(`REDIS_AVAILABLE:  ${await redis.get(stockKey)}`);
  console.log(`VUs PROVISIONED:  ${tokens.length}`);
  console.log('='.repeat(60));
  console.log('[Setup] Load test environment is 100% READY.');
}

main()
  .catch((err) => {
    console.error('[Setup] Error preparing database for load test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
