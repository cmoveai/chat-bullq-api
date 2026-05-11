import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GlobalRole } from '@prisma/client';
import type { Request } from 'express';
import { IS_SUPER_ADMIN_KEY } from '../decorators';
import { AuditService } from '../../modules/audit/audit.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isSuperAdminEndpoint = this.reflector.getAllAndOverride<boolean>(
      IS_SUPER_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!isSuperAdminEndpoint) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as Request & { user?: { id: string; globalRole?: GlobalRole } }).user;

    if (!user || user.globalRole !== 'SUPER_ADMIN') {
      await this.audit.log({
        action: 'super_admin.access_denied',
        userId: user?.id ?? null,
        metadata: { reason: 'not_super_admin', path: req.path },
        req,
      });
      throw new ForbiddenException('Super admin access required');
    }

    const allowlist = (this.config.get<string>('SUPER_ADMIN_IPS') ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    if (allowlist.length > 0) {
      const requestIp = this.extractIp(req);
      if (!requestIp || !allowlist.includes(requestIp)) {
        await this.audit.log({
          action: 'super_admin.access_denied',
          userId: user.id,
          metadata: { reason: 'ip_not_allowed', requestIp, path: req.path },
          req,
        });
        throw new ForbiddenException('Super admin access denied · IP not in allowlist');
      }
    }

    await this.audit.log({
      action: 'super_admin.access',
      userId: user.id,
      metadata: { path: req.path, method: req.method },
      req,
    });

    return true;
  }

  private extractIp(req: Request): string | null {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') return xff.split(',')[0].trim();
    if (Array.isArray(xff)) return xff[0];
    return req.ip ?? req.socket?.remoteAddress ?? null;
  }
}
