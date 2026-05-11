import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators';

/**
 * Guard pra endpoints que esperam JWT do Supabase Auth (Fase 5 SSO).
 *
 * Use em handlers que serão chamados pelo front migrado (Next.js usando
 * @supabase/auth-helpers). Funciona em paralelo com o JwtAuthGuard antigo
 * — escolha o guard por endpoint.
 */
@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase-jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
