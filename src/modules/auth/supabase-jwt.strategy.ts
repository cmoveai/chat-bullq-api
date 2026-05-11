import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PrismaService } from '../../database/prisma.service';

/**
 * Validação de JWT do Supabase Auth (SSO unificado entre LAUNCH e ZAP).
 *
 * Fluxo:
 *   1. Extrai Bearer JWT do header
 *   2. Chama supabase.auth.getUser(jwt) — Supabase valida assinatura + expiry
 *   3. JIT lookup: encontra User no postgres do chat-bullq por email
 *   4. Retorna { id, email, name, supabase_user_id, roles, especialista_id }
 *
 * Se o user existe no Supabase mas NÃO existe no postgres do chat-bullq,
 * retorna 403 com instrução de convidar o usuário pra alguma org.
 */
@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'supabase-jwt') {
  private readonly logger = new Logger(SupabaseJwtStrategy.name);
  private readonly supabase: SupabaseClient;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super();
    const url = configService.get<string>('SUPABASE_URL');
    const anonKey = configService.get<string>('SUPABASE_ANON_KEY');
    if (!url || !anonKey) {
      throw new Error(
        'SUPABASE_URL ou SUPABASE_ANON_KEY ausentes (precisos pra Fase 5 SSO)',
      );
    }
    // Node 20 sem WebSocket nativo é polyfilled em main.ts antes do bootstrap.
    this.supabase = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async validate(req: Request) {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      throw new UnauthorizedException('JWT ausente');
    }
    const jwt = m[1].trim();

    // Supabase valida assinatura + expiry · retorna user
    const { data, error } = await this.supabase.auth.getUser(jwt);
    if (error || !data?.user) {
      this.logger.warn(`JWT inválido: ${error?.message ?? 'sem user'}`);
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }

    const sbUser = data.user;
    const email = sbUser.email?.toLowerCase();
    if (!email) {
      throw new UnauthorizedException('JWT sem email');
    }

    // JIT lookup no postgres do chat-bullq
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      this.logger.warn(
        `Usuário ${email} autenticado no Supabase mas sem conta no ZAP`,
      );
      throw new UnauthorizedException(
        `Conta sem acesso ao chat-bullq · peça pro admin convidar ${email}`,
      );
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Conta inativa');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      // Bonus do Supabase · pode ser usado em rotas que precisam de role/especialista
      supabase_user_id: sbUser.id,
      roles: (sbUser.app_metadata?.roles ?? sbUser.user_metadata?.roles) || [],
      especialista_id:
        sbUser.app_metadata?.especialista_id ??
        sbUser.user_metadata?.especialista_id ??
        null,
    };
  }
}
