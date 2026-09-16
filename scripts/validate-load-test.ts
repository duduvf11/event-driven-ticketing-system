import { prisma } from '../src/config/database';

async function main() {
  const tierId = process.env.TIER_ID || process.argv[2];

  const tier = tierId
    ? await prisma.ticketTier.findUnique({ where: { id: tierId } })
    : await prisma.ticketTier.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!tier) {
    console.error('[Audit] TicketTier not found.');
    process.exit(1);
  }

  const orderItems = await prisma.orderItem.findMany({
    where: { ticketTierId: tier.id },
    include: { order: true },
  });

  const pendingOrders = orderItems.filter((item) => item.order.status === 'PENDING');
  const confirmedOrders = orderItems.filter((item) => item.order.status === 'CONFIRMED');
  const cancelledOrders = orderItems.filter((item) => item.order.status === 'CANCELLED');
  const expiredOrders = orderItems.filter((item) => item.order.status === 'EXPIRED');

  const isOverselling = tier.reservedQty + tier.soldQty > tier.totalQty;

  console.log('='.repeat(60));
  console.log(' POST-TEST DATABASE AUDIT (POSTGRESQL)');
  console.log('='.repeat(60));
  console.log(`Tier ID:            ${tier.id}`);
  console.log(`Tier Name:          ${tier.name}`);
  console.log(`Total Qty:          ${tier.totalQty}`);
  console.log(`Reserved Qty:       ${tier.reservedQty}`);
  console.log(`Sold Qty:           ${tier.soldQty}`);
  console.log(`PENDING Orders:     ${pendingOrders.length}`);
  console.log(`CONFIRMED Orders:   ${confirmedOrders.length}`);
  console.log(`CANCELLED Orders:   ${cancelledOrders.length}`);
  console.log(`EXPIRED Orders:     ${expiredOrders.length}`);
  console.log(`Total Orders:       ${orderItems.length}`);
  console.log(`Overselling Occurred? ${isOverselling ? 'YES (CRITICAL FAILURE)' : 'NO (SUCCESS)'}`);
  console.log(`Integrity Check:    ${tier.reservedQty === 10 && !isOverselling ? '100% INTACT' : 'DIVERGENT'}`);
  console.log('='.repeat(60));
}

main()
  .catch((err) => {
    console.error('[Audit] Error during post-test validation:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
