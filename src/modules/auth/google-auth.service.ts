import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { GoogleProfile } from './google.strategy';
import { provisionDefaultPipeline } from '../pipelines/pipeline-defaults';

/**
 * Cyber Onda 2 · #22 · Google OAuth login flow
 *
 * findOrCreateUser: dado o profile da Google
 *   1. Tenta achar por googleId → existe → login
 *   2. Tenta achar por email → existe → liga googleId + login
 *   3. Não existe → cria user novo + org default + retorna login
 */

interface GoogleAuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; isNew: boolean };
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('GOOGLE_CLIENT_ID');
  }

  async loginOrSignup(profile: GoogleProfile, ip: string | null): Promise<GoogleAuthResult> {
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });
    let isNew = false;

    if (!user) {
      // Tenta linkar conta existente por email
      user = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: profile.googleId,
            // Marca email como verificado se Google diz que é
            emailVerifiedAt: user.emailVerifiedAt ?? (profile.emailVerified ? new Date() : null),
            avatarUrl: user.avatarUrl ?? profile.picture ?? null,
          },
        });
        this.logger.log(`Google linked to existing user · ${user.email}`);
      }
    }

    if (!user) {
      // Cria user + organização nova (mesmo fluxo do register tradicional)
      const slug = await this.generateUniqueSlug(profile.name);
      const created = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            googleId: profile.googleId,
            password: '', // OAuth-only · sem senha local
            avatarUrl: profile.picture ?? null,
            emailVerifiedAt: profile.emailVerified ? new Date() : null,
          },
        });
        const org = await tx.organization.create({
          data: { name: `${profile.name}'s Workspace`, slug },
        });
        await tx.userOrganization.create({
          data: { userId: u.id, organizationId: org.id, role: 'OWNER' },
        });
        const dept = await tx.department.create({
          data: { organizationId: org.id, name: 'Geral', description: 'Departamento padrão', isDefault: true },
        });
        // Não cria departmentAgent agora · membro vira via UI depois
        return { u, orgId: org.id };
      });
      user = created.u;
      isNew = true;

      // CRM out-of-the-box · pipeline default (best-effort, não derruba o login)
      await provisionDefaultPipeline(this.prisma, created.orgId).catch((err) =>
        this.logger.warn(`Default pipeline provisioning failed: ${err.message}`),
      );
      this.logger.log(`Google signup novo · ${user.email}`);
    }

    const { accessToken, refreshToken } = await this.signTokens(user.id, user.email);

    await this.audit.log({
      action: isNew ? 'auth.register' : 'auth.login_success',
      userId: user.id,
      metadata: {
        method: 'google_oauth',
        email: user.email,
        ip,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, isNew },
    };
  }

  private async signTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_EXPIRATION',
          '15m',
        ) as SignOptions['expiresIn'],
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRATION',
          '7d',
        ) as SignOptions['expiresIn'],
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'workspace';
    let slug = base;
    let i = 1;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      slug = `${base}-${i++}`;
      if (i > 100) {
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        break;
      }
    }
    return slug;
  }
}
