import { prisma } from '../src/config/database';

async function main() {
  const tierId = process.env.TIER_ID || process.argv[2];

  const tier = tierId
    ? await prisma.ticketTier.findUnique({ where: { id: tierId } })
    : await prisma.ticketTier.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!tier) {
    console.error('TicketTier não encontrado!');
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
  console.log(' AUDITORIA PÓS-TESTE NO BANCO DE DADOS (POSTGRESQL)');
  console.log('='.repeat(60));
  console.log(`Tier ID:            ${tier.id}`);
  console.log(`Tier Nome:          ${tier.name}`);
  console.log(`Total Qty:          ${tier.totalQty}`);
  console.log(`Reserved Qty:       ${tier.reservedQty}`);
  console.log(`Sold Qty:           ${tier.soldQty}`);
  console.log(`Ordens PENDING:     ${pendingOrders.length}`);
  console.log(`Ordens CONFIRMED:   ${confirmedOrders.length}`);
  console.log(`Ordens CANCELLED:   ${cancelledOrders.length}`);
  console.log(`Ordens EXPIRED:     ${expiredOrders.length}`);
  console.log(`Total de Ordens:    ${orderItems.length}`);
  console.log(`Houve Overselling?  ${isOverselling ? 'SIM (FALHA GRAVE)' : 'NÃO (SUCESSO)'}`);
  console.log(`Integridade:        ${tier.reservedQty === 10 && !isOverselling ? '100% ÍNTEGRA' : 'DIVERGENTE'}`);
  console.log('='.repeat(60));
}

main()
  .catch((err) => {
    console.error('Erro na validação pós-teste:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
