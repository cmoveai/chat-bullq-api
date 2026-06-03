import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { tenantStorage } from '../../database/tenant-context';

/**
 * Fixa o tenant atual no AsyncLocalStorage a partir do header
 * `x-organization-id`, para todo o ciclo do request. O OrgGuard valida o
 * membership depois (request sem membership é barrado antes do handler), e a
 * RLS isola no banco — as duas camadas se reforçam.
 *
 * Sem header (rotas públicas/auth): roda sem tenant. Inerte enquanto
 * RLS_ENFORCED=false.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const orgId = req.headers['x-organization-id'];
    // run({}) isola o contexto por request; enterWith fixa o tenant pra toda a
    // cadeia async do request (sobrevive ao next() síncrono → chega no Prisma).
    // Provado em teste; o padrão run+next sem enterWith perde o contexto.
    tenantStorage.run({}, () => {
      if (typeof orgId === 'string' && orgId.length > 0) {
        tenantStorage.enterWith({ tenantId: orgId });
      }
      next();
    });
  }
}
