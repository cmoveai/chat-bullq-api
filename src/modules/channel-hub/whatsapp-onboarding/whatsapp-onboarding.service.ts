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
import { EncryptionService } from '../../../common/crypto/encryption.service';
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
    private readonly encryption: EncryptionService,
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

    // O evento WA_EMBEDDED_SIGNUP nem sempre vem (fluxo de concessão de acesso
    // do FB Login for Business não emite). Quando faltar waba/phone, descobre
    // pelo token: debug_token → granular_scopes (WABA) → /phone_numbers.
    let wabaId = dto.wabaId;
    let phoneNumberId = dto.phoneNumberId;
    if (!wabaId || !phoneNumberId) {
      const discovered = await this.discoverWabaAndPhone(
        accessToken,
        appId,
        appSecret,
      );
      wabaId = wabaId || discovered.wabaId;
      phoneNumberId = phoneNumberId || discovered.phoneNumberId;
    }

    // Registrar o número é best-effort. Sucesso → 'connected'; falha → 'needs_review'
    // (número precisa de atenção/registro manual), mas o canal é criado mesmo assim.
    const registered = await this.registerPhoneNumber(phoneNumberId, accessToken);
    const connectionStatus = registered ? 'connected' : 'needs_review';

    const displayName = await this.fetchDisplayName(phoneNumberId, accessToken);

    const config = {
      // Segredos cifrados at-rest (AES-256-GCM); as chamadas vivas acima usaram
      // os valores em texto puro, mas no banco vão cifrados.
      accessToken: this.encryption.encrypt(accessToken),
      phoneNumberId,
      businessAccountId: wabaId,
      appSecret: this.encryption.encrypt(appSecret),
      apiVersion: this.apiVersion,
    };

    const name =
      dto.channelName?.trim() ||
      (displayName ? `WhatsApp · ${displayName}` : `WhatsApp · ${phoneNumberId}`);

    // Idempotência: mesmo número já conectado nesta org → atualiza o token.
    const existing = await this.prisma.channel.findFirst({
      where: {
        organizationId,
        type: ChannelType.WHATSAPP_OFFICIAL,
        deletedAt: null,
        config: { path: ['phoneNumberId'], equals: phoneNumberId },
      },
    });

    if (existing) {
      const merged = { ...(existing.config as Record<string, any>), ...config };
      // Reconnect NÃO reativa o canal (preserva isActive) — onboarding não liga
      // o público sozinho. Só atualiza token/segredos e o estado de conexão.
      const updated = await this.prisma.channel.update({
        where: { id: existing.id },
        data: { config: merged, connectionStatus },
      });
      await this.channels
        .enrichProviderIds(updated.id, ChannelType.WHATSAPP_OFFICIAL)
        .catch(() => undefined);
      this.logger.log(
        `WA Embedded Signup: número ${phoneNumberId} reconectado (canal ${updated.id}, org ${organizationId}, status ${connectionStatus})`,
      );
      return updated;
    }

    const created = await this.channels.create(
      organizationId,
      { type: ChannelType.WHATSAPP_OFFICIAL, name, config },
      creator,
    );
    // SEGURO POR PADRÃO: canal do ES nasce com IA OFF e desativado. Sem agente
    // conectado automaticamente, sem resposta pública. Ativação é manual depois.
    const channel = await this.prisma.channel.update({
      where: { id: created.id },
      data: { isActive: false, aiEnabled: false, connectionStatus },
    });
    this.logger.log(
      `WA Embedded Signup: número ${phoneNumberId} conectado (canal ${channel.id}, WABA ${wabaId}, org ${organizationId}, status ${connectionStatus}, isActive=false, aiEnabled=false)`,
    );
    return channel;
  }

  /**
   * Descobre WABA + phone_number_id pelo token quando o evento WA_EMBEDDED_SIGNUP
   * não veio. debug_token devolve granular_scopes; o escopo
   * whatsapp_business_management traz target_ids = WABAs concedidas. Pra cada
   * WABA, /phone_numbers lista os números.
   */
  private async discoverWabaAndPhone(
    accessToken: string,
    appId: string,
    appSecret: string,
  ): Promise<{ wabaId: string; phoneNumberId: string }> {
    try {
      const { data: dbg } = await axios.get(`${this.graphBase}/debug_token`, {
        params: {
          input_token: accessToken,
          access_token: `${appId}|${appSecret}`,
        },
        timeout: 15000,
      });
      const scopes: Array<{ scope: string; target_ids?: string[] }> =
        dbg?.data?.granular_scopes ?? [];
      const waScope = scopes.find(
        (s) => s.scope === 'whatsapp_business_management',
      );
      const wabaIds = waScope?.target_ids ?? [];
      if (!wabaIds.length) {
        throw new BadRequestException(
          'Nenhuma conta WhatsApp (WABA) foi concedida no fluxo. Refaça e selecione a conta.',
        );
      }
      for (const wabaId of wabaIds) {
        const { data: pn } = await axios.get(
          `${this.graphBase}/${wabaId}/phone_numbers`,
          {
            params: { access_token: accessToken },
            timeout: 15000,
          },
        );
        const first = pn?.data?.[0];
        if (first?.id) {
          this.logger.log(
            `WA Embedded Signup: descoberto via Graph WABA ${wabaId} número ${first.id}`,
          );
          return { wabaId, phoneNumberId: String(first.id) };
        }
      }
      throw new BadRequestException(
        'Conta WhatsApp concedida mas sem número de telefone disponível.',
      );
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      const meta = error.response?.data?.error?.message || error.message;
      this.logger.error(`Falha ao descobrir WABA/número via Graph: ${meta}`);
      throw new InternalServerErrorException(
        'Não foi possível identificar a conta WhatsApp conectada.',
      );
    }
  }

  /** Troca o authorization code por um access token (business integration system user). */
  private async exchangeCodeForToken(
    code: string,
    appId: string,
    appSecret: string,
  ): Promise<string> {
    try {
      // Code do Embedded Signup (FB.login override_default_response_type=true,
      // página servida em HTTPS). Troca server-side SEM redirect_uri, conforme
      // doc da Meta. (Em HTTP o FB.login nem roda — exige HTTPS.)
      const { data } = await axios.get(`${this.graphBase}/oauth/access_token`, {
        params: { client_id: appId, client_secret: appSecret, code },
        timeout: 30000,
      });
      if (!data?.access_token) {
        throw new Error('resposta sem access_token');
      }
      return data.access_token as string;
    } catch (error: any) {
      const err = error.response?.data?.error;
      const meta = err?.message || error.message;
      this.logger.error(
        `Falha ao trocar code por token: ${meta}` +
          (err?.error_subcode ? ` (subcode ${err.error_subcode})` : ''),
      );
      throw new InternalServerErrorException(
        'Não foi possível concluir a conexão com a Meta (troca de código falhou).',
      );
    }
  }

  /**
   * Registra o número na Cloud API. Best-effort: só roda com PIN configurado e
   * nunca derruba a conexão — número já registrado retorna erro esperado.
   */
  /** Registra o número na Cloud API (best-effort). Retorna true se ok/já
   *  registrado (ou sem PIN configurado = pula), false se a tentativa falhou. */
  private async registerPhoneNumber(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<boolean> {
    const pin = process.env.META_PHONE_REGISTER_PIN;
    if (!pin) {
      this.logger.warn(
        `META_PHONE_REGISTER_PIN não setado — pulando register do número ${phoneNumberId} (ok se já registrado)`,
      );
      return true;
    }
    try {
      await axios.post(
        `${this.graphBase}/${phoneNumberId}/register`,
        { messaging_product: 'whatsapp', pin },
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 },
      );
      this.logger.log(`Número ${phoneNumberId} registrado na Cloud API`);
      return true;
    } catch (error: any) {
      const meta = error.response?.data?.error?.message || error.message;
      this.logger.warn(
        `register do número ${phoneNumberId} não concluído (canal vai p/ needs_review): ${meta}`,
      );
      return false;
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
