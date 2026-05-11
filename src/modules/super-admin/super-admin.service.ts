import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface SuperAdminKpis {
  totalOrgs: number;
  totalUsers: number;
  messagesToday: number;
  activeChannels: number;
  llmCostMonthUsd: number | null;
  mrrBrl: number | null;
  generatedAt: string;
}

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(): Promise<SuperAdminKpis> {
    const [totalOrgs, totalUsers, messagesToday, activeChannels] =
      await Promise.all([
        this.prisma.organization.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.countMessagesToday(),
        this.prisma.channel.count({ where: { isActive: true, deletedAt: null } }),
      ]);

    return {
      totalOrgs,
      totalUsers,
      messagesToday,
      activeChannels,
      llmCostMonthUsd: null,
      mrrBrl: null,
      generatedAt: new Date().toISOString(),
    };
  }

  private async countMessagesToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.message.count({
      where: { createdAt: { gte: startOfDay } },
    });
  }
}
