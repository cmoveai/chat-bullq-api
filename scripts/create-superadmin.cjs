// Cria/promove um usuário SUPER_ADMIN da plataforma (admin global CMOVE.AI-ZAP).
// Uso: SA_EMAIL=cris@cmove.ai SA_PWD=... SA_NAME="Cris Magalhães" node scripts/create-superadmin.cjs
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

(async () => {
  const email = process.env.SA_EMAIL || 'cris@cmove.ai';
  const name = process.env.SA_NAME || 'Cris Magalhães';
  const password = process.env.SA_PWD;
  if (!password) {
    console.error('Defina SA_PWD');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      globalRole: 'SUPER_ADMIN',
      isActive: true,
      password: hash,
      emailVerifiedAt: new Date(),
    },
    create: {
      name,
      email,
      password: hash,
      isActive: true,
      emailVerifiedAt: new Date(),
      globalRole: 'SUPER_ADMIN',
    },
  });

  console.log(`super-admin pronto: ${user.email} · globalRole=${user.globalRole}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
