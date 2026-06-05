import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/crypto/encryption.service';

export interface UpsertCapiConfigInput {
  pixelId?: string | null;
  datasetId?: string | null;
  accessToken?: string | null;
  testEventCode?: string | null;
  actionSource?: string;
  apiVersion?: string;
  enabled?: boolean;
}

@Injectable()
export class MetaCapiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Config crua (uso interno do sender). Token continua cifrado aqui. */
  async getRaw(organizationId: string) {
    return this.prisma.metaCapiConfig.findUnique({ where: { organizationId } });
  }

  /** Token em claro (uso interno do sender). Null se não houver. */
  decryptToken(cipher?: string | null): string | null {
    if (!cipher) return null;
    return this.encryption.decrypt(cipher);
  }

  /** Versão da API NUNCA expõe o token — só sinaliza se há um configurado. */
  async getMasked(organizationId: string) {
    const cfg = await this.getRaw(organizationId);
    if (!cfg) return null;
    const { accessToken, ...rest } = cfg;
    return { ...rest, hasToken: !!accessToken };
  }

  async upsert(organizationId: string, input: UpsertCapiConfigInput) {
    const data: Record<string, any> = {};
    if (input.pixelId !== undefined) data.pixelId = input.pixelId;
    if (input.datasetId !== undefined) data.datasetId = input.datasetId;
    if (input.testEventCode !== undefined) data.testEventCode = input.testEventCode;
    if (input.actionSource !== undefined) data.actionSource = input.actionSource;
    if (input.apiVersion !== undefined) data.apiVersion = input.apiVersion;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    // Token: cifra at-rest. String vazia limpa; undefined não mexe.
    if (input.accessToken !== undefined) {
      data.accessToken = input.accessToken ? this.encryption.encrypt(input.accessToken) : null;
    }

    await this.prisma.metaCapiConfig.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    return this.getMasked(organizationId);
  }
}
