import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthTokenType } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';

const TOKEN_BYTES = 32;
const TTL_VERIFY_EMAIL_HOURS = 24;
const TTL_RESET_PASSWORD_HOURS = 1;

@Injectable()
export class AuthTokensService {
  private readonly logger = new Logger(AuthTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria token efêmero · plaintext só vai por email · DB guarda só o hash.
   * Cancela tokens não-usados anteriores do mesmo type pra evitar acumular.
   * Retorna o plaintext pra ser embed no link de email.
   */
  async create(userId: string, type: AuthTokenType): Promise<string> {
    const plaintext = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hash(plaintext);

    const ttlHours = type === AuthTokenType.VERIFY_EMAIL ? TTL_VERIFY_EMAIL_HOURS : TTL_RESET_PASSWORD_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.authToken.updateMany({
        where: { userId, type, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() }, // invalida tokens anteriores
      });
      await tx.authToken.create({
        data: { userId, type, tokenHash, expiresAt },
      });
    });

    return plaintext;
  }

  /**
   * Consome o token · valida hash, expiração, tipo, single-use. Retorna userId.
   * Lança UnauthorizedException se inválido. Marca usedAt depois do consumo OK.
   */
  async consume(plaintext: string, type: AuthTokenType): Promise<string> {
    const tokenHash = this.hash(plaintext);
    const row = await this.prisma.authToken.findUnique({
      where: { tokenHash },
    });

    if (!row || row.type !== type) {
      throw new UnauthorizedException('Token inválido');
    }
    if (row.usedAt) {
      throw new UnauthorizedException('Token já utilizado');
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expirado');
    }

    await this.prisma.authToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    return row.userId;
  }

  private hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }
}
