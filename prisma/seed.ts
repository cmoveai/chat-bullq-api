import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@cmove.ai';
  const adminPassword = 'Admin@123';
  const adminName = 'Admin CMOVE.AI';

  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existing) {
    console.log(`✓ Usuário admin já existe: ${adminEmail}`);
    return;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        isActive: true,
      },
    });

    const slug = `cmove-admin-${Date.now().toString(36)}`;

    const organization = await tx.organization.create({
      data: {
        name: 'CMOVE.AI',
        slug,
        plan: 'enterprise',
        settings: {
          maxAgents: 999,
          maxChannels: 999,
          maxDepartments: 999,
        },
      },
    });

    const userOrg = await tx.userOrganization.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: 'OWNER',
        agentStatus: 'ONLINE',
        maxConcurrent: 99,
      },
    });

    const department = await tx.department.create({
      data: {
        organizationId: organization.id,
        name: 'Geral',
        description: 'Departamento padrão',
        isDefault: true,
      },
    });

    await tx.departmentAgent.create({
      data: {
        departmentId: department.id,
        userOrganizationId: userOrg.id,
      },
    });

    return { user, organization };
  });

  console.log('═══════════════════════════════════════════');
  console.log('  ADMIN OWNER CRIADO COM SUCESSO');
  console.log('═══════════════════════════════════════════');
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Senha:    ${adminPassword}`);
  console.log(`  Nome:     ${result.user.name}`);
  console.log(`  Org:      ${result.organization.name}`);
  console.log(`  Slug:     ${result.organization.slug}`);
  console.log(`  Role:     OWNER (permissão total)`);
  console.log('═══════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('Erro ao executar seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
