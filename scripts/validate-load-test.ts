import fs from 'fs';
import path from 'path';
import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';

async function main() {
  let tierId = process.env.TIER_ID || process.env.LOAD_TEST_TIER_ID || process.argv[2];

  // If not provided, try to read from tests/load/test-data.json
  if (!tierId) {
    const testDataPath = path.join(__dirname, '../tests/load/test-data.json');
    if (fs.existsSync(testDataPath)) {
      try {
        const testData = JSON.parse(fs.readFileSync(testDataPath, 'utf-8'));
        tierId = testData.tierId;
      } catch (e) {}
    }
  }

  const tier = tierId
    ? await prisma.ticketTier.findUnique({ where: { id: tierId } })
    : await prisma.ticketTier.findFirst({ orderBy: { createdAt: 'desc' } });

  if (!tier) {
    console.error('[Audit] TicketTier not found.');
    process.exit(1);
  }

  // 1. Fetch PostgreSQL Order Accounting
  const orderItems = await prisma.orderItem.findMany({
    where: { ticketTierId: tier.id },
    include: { order: true },
  });

  const pendingOrders = orderItems.filter((item) => item.order.status === 'PENDING');
  const confirmedOrders = orderItems.filter((item) => item.order.status === 'CONFIRMED');
  const cancelledOrders = orderItems.filter((item) => item.order.status === 'CANCELLED');
  const expiredOrders = orderItems.filter((item) => item.order.status === 'EXPIRED');

  // 2. Fetch Redis Inventory Balance
  const stockKey = `ticket_tier:${tier.id}:available`;
  const redisRawAvailable = await redis.get(stockKey);
  const redisAvailable = redisRawAvailable !== null ? Number(redisRawAvailable) : NaN;

  // 3. Mathematical Proofs
  const pgAvailable = tier.totalQty - (tier.reservedQty + tier.soldQty);
  const isOverselling = tier.reservedQty + tier.soldQty > tier.totalQty;
  const isRedisInSync = redisAvailable === pgAvailable;
  const isOrderCountConsistent = pendingOrders.length === tier.reservedQty;
  const isZeroOversellingProven = !isOverselling && (tier.reservedQty + tier.soldQty <= tier.totalQty);
  const isFullCapacityReached = (tier.reservedQty + tier.soldQty) === tier.totalQty;

  const isAuditFullyPassed = isZeroOversellingProven && isRedisInSync && isOrderCountConsistent && isFullCapacityReached;

  console.log('\n' + '='.repeat(68));
  console.log('       POST-TEST INTEGRITY & RECONCILIATION AUDIT (PHASE 14)');
  console.log('='.repeat(68));
  console.log(` Tier UUID:              ${tier.id}`);
  console.log(` Tier Name:              ${tier.name}`);
  console.log(` Initial Total Stock:    ${tier.totalQty}`);
  console.log('-'.repeat(68));
  console.log(' POSTGRESQL STATE MACHINE ACCOUNTING:');
  console.log(`   Reserved Quantity:    ${tier.reservedQty}`);
  console.log(`   Sold Quantity:        ${tier.soldQty}`);
  console.log(`   Available (Computed): ${pgAvailable}`);
  console.log(`   PENDING Orders:       ${pendingOrders.length}`);
  console.log(`   CONFIRMED Orders:     ${confirmedOrders.length}`);
  console.log(`   CANCELLED Orders:     ${cancelledOrders.length}`);
  console.log(`   EXPIRED Orders:       ${expiredOrders.length}`);
  console.log(`   Total Orders in DB:   ${orderItems.length}`);
  console.log('-'.repeat(68));
  console.log(' REDIS INVENTORY CACHE PARITY:');
  console.log(`   Key [${stockKey}]: ${redisAvailable}`);
  console.log(`   Parity (Redis == PG): ${isRedisInSync ? 'PERFECT MATCH (Identical)' : 'MISMATCH (Divergent)'}`);
  console.log('-'.repeat(68));
  console.log(' MATHEMATICAL INTEGRITY PROOFS:');
  console.log(`   Overselling Occurred: ${isOverselling ? 'YES (CRITICAL FAILURE)' : 'NO (ZERO OVERSELLING)'}`);
  console.log(`   Stock Invariant:      ${tier.reservedQty + tier.soldQty} <= ${tier.totalQty} [${isZeroOversellingProven ? 'PROVEN' : 'VIOLATED'}]`);
  console.log(`   Order Integrity:      ${pendingOrders.length} orders == ${tier.reservedQty} reserved [${isOrderCountConsistent ? 'VALID' : 'INVALID'}]`);
  console.log(`   Full Allocation:      ${tier.reservedQty}/${tier.totalQty} allocated [${isFullCapacityReached ? 'SUCCESS' : 'INCOMPLETE'}]`);
  console.log('='.repeat(68));

  if (isAuditFullyPassed) {
    console.log(' >>> AUDIT VERDICT: 100% SUCCESS — ZERO OVERSELLING & DATA INTEGRITY INTACT <<<\n');
  } else {
    console.error(' >>> AUDIT VERDICT: INTEGRITY FAILURE DETECTED <<<\n');
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('[Audit] Error during post-test validation:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
