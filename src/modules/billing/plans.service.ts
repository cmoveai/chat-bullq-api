import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista catálogo público de planos · só ativos · ordenados. */
  async listActive() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findByCode(code: string) {
    return this.prisma.plan.findUnique({ where: { code } });
  }
}
