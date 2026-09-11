import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.ticketTier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('senha123', 10);

  const user = await prisma.user.create({
    data: {
      name: 'Eduardo Aventureiro',
      email: 'eduardo@teste.com',
      passwordHash,
    },
  });

  const event = await prisma.event.create({
    data: {
      title: 'Festival Medieval de Rock 2026',
      description: 'O maior torneio musical dos reinos esquecidos.',
      location: 'Arena Central',
      eventDate: new Date('2026-11-20T20:00:00Z'),
    },
  });

  await prisma.ticketTier.createMany({
    data: [
      {
        eventId: event.id,
        name: 'Pista Comum',
        price: 80.0,
        totalQty: 100,
        reservedQty: 0,
        soldQty: 0,
      },
      {
        eventId: event.id,
        name: 'Camarote Real (VIP)',
        price: 250.0,
        totalQty: 20,
        reservedQty: 0,
        soldQty: 0,
      },
    ],
  });

  console.log('Mundo povoado com sucesso pelo Seed!');
}

main()
  .catch((e) => {
    console.error('Falha no ritual de seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });