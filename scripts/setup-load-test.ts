import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';

async function main() {
  // 1. Connect and find the first existing TicketTier (or create one if empty)
  let tier = await prisma.ticketTier.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!tier) {
    const event = await prisma.event.create({
      data: {
        title: 'Load Test Event',
        description: 'Temporary event created for k6 concurrency test',
        location: 'Virtual Load Arena',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Concurrency Test Tier',
        price: 50.0,
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  } else {
    // Clean up previous orders associated with this tier to ensure clean test state
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

    // 2. Reset this tier to strict baseline test state
    tier = await prisma.ticketTier.update({
      where: { id: tier.id },
      data: {
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  }

  // Clear any residual lock in Redis for this tier
  await redis.del(`lock:ticket_tier:${tier.id}`);

  console.log(`TIER_ID: ${tier.id}`);
  console.log(`TIER_NAME: ${tier.name}`);
  console.log(`TOTAL_QTY: ${tier.totalQty}`);
  console.log(`RESERVED_QTY: ${tier.reservedQty}`);
  console.log(`SOLD_QTY: ${tier.soldQty}`);
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
