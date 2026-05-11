import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { Request } from 'express';

/**
 * Cyber Onda 1 · S1.10 · audit log service.
 *
 * Append-only · falha silenciosa (não bloqueia o caller se DB cair).
 * Captura: action (verbo), target (recurso afetado), ip, user agent.
 *
 * Use diretamente em endpoints de ações sensíveis OU via interceptor.
 */
export type AuditAction =
  | 'auth.login_success'
  | 'auth.login_failure'
  | 'auth.lockout'
  | 'auth.register'
  | 'auth.refresh'
  | 'auth.email_verified'
  | 'auth.password_reset'
  | 'lgpd.export'
  | 'lgpd.delete_scheduled'
  | 'lgpd.delete_canceled'
  | 'user.created'
  | 'user.deactivated'
  | 'user.password_changed'
  | 'org.created'
  | 'org.deleted'
  | 'org.plan_changed'
  | 'invite.sent'
  | 'invite.accepted'
  | 'invite.revoked'
  | 'channel.created'
  | 'channel.deleted'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'super_admin.access'
  | 'super_admin.access_denied';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: {
    action: AuditAction;
    userId?: string | null;
    organizationId?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    req?: Request | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: params.action,
          userId: params.userId ?? null,
          organizationId: params.organizationId ?? null,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          ip: params.req ? this.extractIp(params.req) : null,
          userAgent: params.req
            ? (params.req.headers['user-agent'] as string | undefined) ?? null
            : null,
          metadata: (params.metadata ?? {}) as never,
        },
      });
    } catch (err) {
      this.logger.warn(
        `audit log failed (action=${params.action}): ${(err as Error).message}`,
      );
    }
  }

  private extractIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    if (Array.isArray(xff)) return xff[0];
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }
}
