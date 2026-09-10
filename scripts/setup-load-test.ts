import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';

async function main() {
  // 1. Conecta e busca o primeiro registro de TicketTier existente (ou cria se vazio)
  let tier = await prisma.ticketTier.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!tier) {
    const event = await prisma.event.create({
      data: {
        title: 'Evento de Teste de Carga',
        description: 'Evento temporário criado para o teste de concorrência com k6',
        location: 'Arena Virtual de Carga',
        eventDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    tier = await prisma.ticketTier.create({
      data: {
        eventId: event.id,
        name: 'Lote Teste de Concorrência',
        price: 50.0,
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  } else {
    // Limpar pedidos anteriores associados a este tier para garantir auditoria 100% limpa
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

    // 2. Resete e trave esse tier para um estado estrito de teste
    tier = await prisma.ticketTier.update({
      where: { id: tier.id },
      data: {
        totalQty: 10,
        reservedQty: 0,
        soldQty: 0,
      },
    });
  }

  // Limpar qualquer lock residual no Redis para esse tier
  await redis.del(`lock:ticket_tier:${tier.id}`);

  console.log(`TIER_ID: ${tier.id}`);
  console.log(`TIER_NAME: ${tier.name}`);
  console.log(`TOTAL_QTY: ${tier.totalQty}`);
  console.log(`RESERVED_QTY: ${tier.reservedQty}`);
  console.log(`SOLD_QTY: ${tier.soldQty}`);
}

main()
  .catch((err) => {
    console.error('Erro na preparação do banco:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });
