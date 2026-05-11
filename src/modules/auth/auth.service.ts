import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { SignOptions } from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { LoginAttemptsService } from './login-attempts.service';
import { PasswordPolicyService } from './password-policy.service';
import { AuthTokensService } from './auth-tokens.service';
import { EmailService } from '../email/email.service';
import { SubscriptionsService } from '../billing/subscriptions.service';
import { AuthTokenType } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly loginAttempts: LoginAttemptsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly email: EmailService,
    private readonly subscriptions: SubscriptionsService,
    private readonly authTokens: AuthTokensService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Cyber Onda 1 · S1.7 · Senha forte obrigatória
    await this.passwordPolicy.assertStrong(dto.password, [
      dto.email,
      dto.name,
    ]);

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Check if registering via invitation
    if (dto.inviteToken) {
      return this.registerWithInvite(dto, hashedPassword);
    }

    return this.registerNewWorkspace(dto, hashedPassword);
  }

  private async registerNewWorkspace(dto: RegisterDto, hashedPassword: string) {
    const slug = this.generateSlug(dto.name);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: `${dto.name}'s Workspace`,
          slug,
        },
      });

      await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'OWNER',
        },
      });

      const defaultDepartment = await tx.department.create({
        data: {
          organizationId: organization.id,
          name: 'Geral',
          description: 'Departamento padrão',
          isDefault: true,
        },
      });

      const userOrg = await tx.userOrganization.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: organization.id,
          },
        },
      });

      if (userOrg) {
        await tx.departmentAgent.create({
          data: {
            departmentId: defaultDepartment.id,
            userOrganizationId: userOrg.id,
          },
        });
      }

      return { user, organization };
    });

    const tokens = await this.generateTokens(result.user.id, result.user.email);
    this.logger.log(`User registered (new workspace): ${result.user.email}`);

    // Trial 7 dias automático · plan SOLO default · sem cartão na frente
    await this.subscriptions
      .createTrialForOrg(result.organization.id)
      .catch((err) => this.logger.warn(`Trial subscription failed: ${err.message}`));

    // Cyber Onda 1 · S1.5 · email verification obrigatório
    // Gera token + dispara verify · welcome só sai depois do clique no link
    try {
      const verifyToken = await this.authTokens.create(result.user.id, AuthTokenType.VERIFY_EMAIL);
      await this.email.sendVerifyEmail(result.user.email, result.user.name, verifyToken);
    } catch (err: any) {
      this.logger.warn(`Verify email failed: ${err.message}`);
    }

    return {
      user: this.sanitizeUser(result.user),
      organizations: [{
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        role: 'OWNER',
        accessibleChannelIds: 'ALL' as const,
      }],
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  private async registerWithInvite(dto: RegisterDto, hashedPassword: string) {
    // Validate the invitation
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: dto.inviteToken },
      include: { organization: true },
    });

    if (!invitation) {
      throw new BadRequestException('Invalid invitation token');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    if (invitation.email !== dto.email) {
      throw new BadRequestException('Email does not match the invitation');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          password: hashedPassword,
        },
      });

      // Add user to the invited organization
      const membership = await tx.userOrganization.create({
        data: {
          userId: user.id,
          organizationId: invitation.organizationId,
          role: invitation.role,
        },
      });

      // Add to default department
      const defaultDept = await tx.department.findFirst({
        where: { organizationId: invitation.organizationId, isDefault: true },
      });

      if (defaultDept) {
        await tx.departmentAgent.create({
          data: {
            departmentId: defaultDept.id,
            userOrganizationId: membership.id,
          },
        });
      }

      // Mark invitation as accepted
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });

      // Also accept any other pending invitations for this email
      await tx.invitation.updateMany({
        where: {
          email: dto.email,
          status: 'PENDING',
          id: { not: invitation.id },
        },
        data: { status: 'EXPIRED' },
      });

      return { user, organization: invitation.organization };
    });

    const tokens = await this.generateTokens(result.user.id, result.user.email);
    this.logger.log(`User registered via invitation: ${result.user.email} -> org ${result.organization.name}`);

    return {
      user: this.sanitizeUser(result.user),
      organizations: [{
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        role: invitation.role,
        // New invited members start with no channel grants (deny-by-default).
        // OWNER/ADMIN bypass; AGENT must be explicitly granted by an admin.
        accessibleChannelIds:
          invitation.role === 'OWNER' || invitation.role === 'ADMIN'
            ? ('ALL' as const)
            : ([] as string[]),
      }],
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async login(dto: LoginDto) {
    // Cyber Onda 1 · S1.6 · brute-force lockout
    const lockMs = await this.loginAttempts.getLockMsRemaining(dto.email);
    if (lockMs > 0) {
      const min = Math.ceil(lockMs / 60_000);
      throw new HttpException(
        `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ~${min}min.`,
        HttpStatus.LOCKED,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Conta as falhas mesmo se email não existir · evita user enumeration via timing
      await this.loginAttempts.recordFail(dto.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      const result = await this.loginAttempts.recordFail(dto.email);
      if (result.locked) {
        const min = Math.ceil(result.lockMsRemaining / 60_000);
        throw new HttpException(
          `Conta bloqueada por ${min}min após ${result.fails} tentativas. Aguarde ou use "esqueci minha senha".`,
          HttpStatus.LOCKED,
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!user.emailVerifiedAt) {
      throw new HttpException(
        'Confirme seu e-mail antes de fazer login. Verifique sua caixa de entrada ou peça reenvio.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Login OK · zera contador de falhas
    await this.loginAttempts.recordSuccess(dto.email);

    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId: user.id },
      include: {
        organization: true,
        channelAgents: { select: { channelId: true } },
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: this.sanitizeUser(user),
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        accessibleChannelIds:
          m.role === 'OWNER' || m.role === 'ADMIN'
            ? ('ALL' as const)
            : m.channelAgents.map((c) => c.channelId),
      })),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /** Cyber Onda 1 · S1.5 · valida token de verificação e marca emailVerifiedAt + welcome */
  async verifyEmail(token: string): Promise<string> {
    const userId = await this.authTokens.consume(token, AuthTokenType.VERIFY_EMAIL);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    // Welcome email com checklist · só agora que confirmou o email
    this.email
      .sendWelcomeEmail(user.email, user.name)
      .catch((err) => this.logger.warn(`Welcome email failed: ${err.message}`));
    return userId;
  }

  /** Reenvio de verificação · idempotente · não revela existência de conta */
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return; // silencioso · não vaza enumeração
    try {
      const token = await this.authTokens.create(user.id, AuthTokenType.VERIFY_EMAIL);
      await this.email.sendVerifyEmail(user.email, user.name, token);
    } catch (err: any) {
      this.logger.warn(`Resend verification failed: ${err.message}`);
    }
  }

  /** Cyber Onda 1 · S1.6 · gera token reset · envia email · não vaza existência da conta */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return; // silencioso
    try {
      const token = await this.authTokens.create(user.id, AuthTokenType.RESET_PASSWORD);
      await this.email.sendResetPasswordEmail(user.email, user.name, token);
    } catch (err: any) {
      this.logger.warn(`Forgot password failed: ${err.message}`);
    }
  }

  /** Valida token reset + senha policy + grava nova senha · invalida sessões via lockout reset */
  async resetPassword(token: string, newPassword: string): Promise<string> {
    const userId = await this.authTokens.consume(token, AuthTokenType.RESET_PASSWORD);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    await this.passwordPolicy.assertStrong(newPassword, [user.email, user.name]);
    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
    await this.loginAttempts.recordSuccess(user.email); // zera lockout pra deixar logar

    this.logger.log(`Password reset for user ${userId}`);
    return userId;
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify<{ sub: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.generateTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException();

    const memberships = await this.prisma.userOrganization.findMany({
      where: { userId },
      include: {
        organization: true,
        channelAgents: { select: { channelId: true } },
      },
    });

    return {
      user: this.sanitizeUser(user),
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        // 'ALL' for OWNER/ADMIN — they bypass the per-channel allowlist.
        accessibleChannelIds:
          m.role === 'OWNER' || m.role === 'ADMIN'
            ? ('ALL' as const)
            : m.channelAgents.map((c) => c.channelId),
      })),
    };
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: this.config.get<string>('JWT_EXPIRATION', '15m') as SignOptions['expiresIn'],
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRATION', '7d') as SignOptions['expiresIn'],
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: { password: string; [key: string]: unknown }) {
    const { password: _, ...rest } = user;
    return rest;
  }

  private generateSlug(name: string): string {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return `${base}-${Date.now().toString(36)}`;
  }
}
