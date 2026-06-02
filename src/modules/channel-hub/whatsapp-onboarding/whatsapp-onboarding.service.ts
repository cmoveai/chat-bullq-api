import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ChannelType, OrgRole } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../../../database/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { EmbeddedSignupDto } from './dto/embedded-signup.dto';

/**
 * Cola do Embedded Signup (Tech Provider / multi-tenant).
 *
 * Fluxo, a partir do `code` que o front captura no FB Login for Business:
 *   1. troca o code por um access token de business integration system user
 *      (`GET /oauth/access_token`, com APP_ID + APP_SECRET);
 *   2. registra o número na Cloud API (`POST /{phone_number_id}/register`) —
 *      best-effort, só roda se houver PIN configurado;
 *   3. monta o `config` do canal (token + tríade) e delega ao
 *      `ChannelsService.create`, que JÁ assina o app na WABA
 *      (`POST /{waba}/subscribed_apps`) e enriquece os IDs do roteador.
 *
 * Idempotente por (org, phoneNumberId): reconectar o mesmo número atualiza o
 * token do canal existente em vez de duplicar.
 *
 * Config de app (server-side), vindas do .env — preenchidas quando a Business
 * Verification for aprovada e o Embedded Signup tiver `config_id`:
 *   META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION (default v21.0),
 *   META_PHONE_REGISTER_PIN (opcional).
 */
@Injectable()
export class WhatsAppOnboardingService {
  private readonly logger = new Logger(WhatsAppOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  private get apiVersion(): string {
    return process.env.META_GRAPH_VERSION || 'v21.0';
  }

  private get graphBase(): string {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }

  async connect(
    organizationId: string,
    dto: EmbeddedSignupDto,
    creator?: { userOrganizationId: string; role: OrgRole },
  ) {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new BadRequestException(
        'Embedded Signup não configurado no servidor (faltam META_APP_ID/META_APP_SECRET).',
      );
    }

    const accessToken = await this.exchangeCodeForToken(dto.code, appId, appSecret);

    // Registrar o número é best-effort: números recém-criados no ES costumam
    // precisar; números já registrados retornam erro que ignoramos.
    await this.registerPhoneNumber(dto.phoneNumberId, accessToken);

    const displayName = await this.fetchDisplayName(dto.phoneNumberId, accessToken);

    const config = {
      accessToken,
      phoneNumberId: dto.phoneNumberId,
      businessAccountId: dto.wabaId,
      appSecret,
      apiVersion: this.apiVersion,
    };

    const name =
      dto.channelName?.trim() ||
      (displayName ? `WhatsApp · ${displayName}` : `WhatsApp · ${dto.phoneNumberId}`);

    // Idempotência: mesmo número já conectado nesta org → atualiza o token.
    const existing = await this.prisma.channel.findFirst({
      where: {
        organizationId,
        type: ChannelType.WHATSAPP_OFFICIAL,
        deletedAt: null,
        config: { path: ['phoneNumberId'], equals: dto.phoneNumberId },
      },
    });

    if (existing) {
      const merged = { ...(existing.config as Record<string, any>), ...config };
      const updated = await this.prisma.channel.update({
        where: { id: existing.id },
        data: { config: merged, isActive: true },
      });
      // Garante a assinatura do app na WABA mesmo no reconnect.
      await this.channels
        .enrichProviderIds(updated.id, ChannelType.WHATSAPP_OFFICIAL)
        .catch(() => undefined);
      this.logger.log(
        `WA Embedded Signup: número ${dto.phoneNumberId} reconectado (canal ${updated.id}, org ${organizationId})`,
      );
      return updated;
    }

    const channel = await this.channels.create(
      organizationId,
      { type: ChannelType.WHATSAPP_OFFICIAL, name, config },
      creator,
    );
    this.logger.log(
      `WA Embedded Signup: número ${dto.phoneNumberId} conectado (canal ${channel.id}, WABA ${dto.wabaId}, org ${organizationId})`,
    );
    return channel;
  }

  /** Troca o authorization code por um access token (business integration system user). */
  private async exchangeCodeForToken(
    code: string,
    appId: string,
    appSecret: string,
  ): Promise<string> {
    try {
      const { data } = await axios.get(`${this.graphBase}/oauth/access_token`, {
        params: { client_id: appId, client_secret: appSecret, code },
        timeout: 30000,
      });
      if (!data?.access_token) {
        throw new Error('resposta sem access_token');
      }
      return data.access_token as string;
    } catch (error: any) {
      const meta = error.response?.data?.error?.message || error.message;
      this.logger.error(`Falha ao trocar code por token: ${meta}`);
      throw new InternalServerErrorException(
        'Não foi possível concluir a conexão com a Meta (troca de código falhou).',
      );
    }
  }

  /**
   * Registra o número na Cloud API. Best-effort: só roda com PIN configurado e
   * nunca derruba a conexão — número já registrado retorna erro esperado.
   */
  private async registerPhoneNumber(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<void> {
    const pin = process.env.META_PHONE_REGISTER_PIN;
    if (!pin) {
      this.logger.warn(
        `META_PHONE_REGISTER_PIN não setado — pulando register do número ${phoneNumberId} (ok se já registrado)`,
      );
      return;
    }
    try {
      await axios.post(
        `${this.graphBase}/${phoneNumberId}/register`,
        { messaging_product: 'whatsapp', pin },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 },
      );
      this.logger.log(`Número ${phoneNumberId} registrado na Cloud API`);
    } catch (error: any) {
      const meta = error.response?.data?.error?.message || error.message;
      this.logger.warn(
        `register do número ${phoneNumberId} não concluído (seguindo mesmo assim): ${meta}`,
      );
    }
  }

  /** Busca o número de exibição pra nomear o canal. Best-effort. */
  private async fetchDisplayName(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const { data } = await axios.get(`${this.graphBase}/${phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name' },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });
      return data?.verified_name || data?.display_phone_number || null;
    } catch {
      return null;
    }
  }
}
