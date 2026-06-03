import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const DELETION_GRACE_DAYS = 30;

@Injectable()
export class LgpdService {
  private readonly logger = new Logger(LgpdService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Coleta TODOS os dados pessoais do user em formato JSON estruturado.
   * Cobre: cadastro, organizações, canais, mensagens enviadas, notificações,
   * push subscriptions, audit log, sessões. Subprocessadores (Meta, Resend etc.)
   * têm os dados expostos por meio das tabelas locais que armazenam o que veio.
   */
  async exportUserData(userId: string) {
    const [
      user,
      memberships,
      sentMessages,
      notifications,
      pushSubs,
      apiKeys,
      conversationReads,
      authTokens,
      auditLog,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, avatarUrl: true, isActive: true,
          emailVerifiedAt: true, createdAt: true, updatedAt: true,
        },
      }),
      this.prisma.userOrganization.findMany({
        where: { userId },
        include: { organization: { select: { id: true, name: true, slug: true, plan: true } } },
      }),
      this.prisma.message.findMany({
        where: { senderId: userId },
        select: { id: true, conversationId: true, content: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000, // hard cap pra evitar export gigante
      }),
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        select: { id: true, type: true, title: true, body: true, createdAt: true, readAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pushSubscription.findMany({
        where: { userId },
        select: { id: true, endpoint: true, createdAt: true },
      }),
      this.prisma.apiKey.findMany({
        where: { userId },
        select: { id: true, name: true, createdAt: true, lastUsedAt: true, revokedAt: true },
      }),
      this.prisma.conversationRead.findMany({
        where: { userId },
        select: { conversationId: true, lastReadAt: true },
        take: 5000,
      }),
      this.prisma.authToken.findMany({
        where: { userId },
        select: { id: true, type: true, createdAt: true, usedAt: true, expiresAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    return {
      _meta: {
        exportedAt: new Date().toISOString(),
        platform: 'EIXXO',
        version: '1.0',
        legalBasis: 'LGPD Art. 18, II e V (acesso e portabilidade)',
        contact: 'cris@cmove.ai',
      },
      user,
      memberships,
      sentMessages,
      notifications,
      pushSubscriptions: pushSubs,
      apiKeys,
      conversationReads,
      authTokens,
      auditLog,
    };
  }

  /**
   * Marca a conta pra exclusão em 30 dias. Soft delete + flag pra cron.
   * Cron diário (futuro) varre users com deletedAt no passado e faz hard delete.
   */
  /**
   * Marca data futura em `deletedAt` (D+30). User segue ativo durante a janela
   * pra poder fazer login e CANCELAR a exclusão se mudar de ideia. Cron diário
   * (futuro) varre users com deletedAt no passado e faz hard delete real.
   */
  async scheduleDeletion(userId: string): Promise<Date> {
    const scheduledFor = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: scheduledFor },
    });
    this.logger.warn(`User ${userId} scheduled for deletion at ${scheduledFor.toISOString()}`);
    return scheduledFor;
  }

  /** Cancela exclusão agendada · limpa deletedAt. */
  async cancelDeletion(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: null },
    });
    this.logger.log(`User ${userId} deletion canceled`);
  }
}
