import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';

const TOKEN_BYTES = 32;
// Janela para o convidado USAR o convite (cadastro). Não confundir com o trial
// de 7 dias, que nasce no register. Default 7 dias.
const DEFAULT_TTL_HOURS = 168;

/**
 * Convites de piloto fechado (cadastro self-service). O token bruto é gerado
 * uma única vez e NUNCA é persistido em claro — guardamos só o sha256. O token
 * é opaco, aleatório, single-use, expirável e vinculado ao e-mail aprovado.
 */
@Injectable()
export class PilotInviteService {
  private readonly logger = new Logger(PilotInviteService.name);

  constructor(private readonly prisma: PrismaService) {}

  private hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  /** Emite um convite. Retorna o token BRUTO uma única vez (nunca logado). */
  async create(
    email: string,
    opts?: { ttlHours?: number; createdBy?: string },
  ): Promise<{ token: string; id: string; email: string; expiresAt: Date }> {
    const normalizedEmail = email.trim().toLowerCase();
    const plaintext = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hash(plaintext);
    const ttlHours = opts?.ttlHours && opts.ttlHours > 0 ? opts.ttlHours : DEFAULT_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const invite = await this.prisma.pilotInvite.create({
      data: {
        tokenHash,
        email: normalizedEmail,
        status: 'PENDING',
        expiresAt,
        createdBy: opts?.createdBy ?? null,
      },
    });
    this.logger.log(`Pilot invite created for ${normalizedEmail} · expires ${expiresAt.toISOString()}`);
    return { token: plaintext, id: invite.id, email: invite.email, expiresAt: invite.expiresAt };
  }

  /**
   * Valida o token bruto contra o e-mail do cadastro. Lança erro claro e seguro
   * se inválido/expirado/usado/revogado ou se o e-mail divergir. Retorna o
   * convite (para ser consumido na transação do register).
   */
  async validate(plaintext: string, email: string) {
    const tokenHash = this.hash(plaintext);
    const invite = await this.prisma.pilotInvite.findUnique({ where: { tokenHash } });
    if (!invite) {
      throw new BadRequestException('Convite de piloto inválido.');
    }
    if (invite.revokedAt) {
      throw new BadRequestException('Convite de piloto revogado. Fale com a EIXXO.');
    }
    if (invite.usedAt || invite.status === 'USED') {
      throw new BadRequestException('Convite de piloto já utilizado. Fale com a EIXXO.');
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Convite de piloto expirado. Fale com a EIXXO.');
    }
    if (invite.email.toLowerCase() !== email.trim().toLowerCase()) {
      throw new BadRequestException('Este convite de piloto é para outro e-mail.');
    }
    return invite;
  }
}
