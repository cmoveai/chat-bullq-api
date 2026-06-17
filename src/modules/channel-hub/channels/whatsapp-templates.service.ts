import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../../database/prisma.service';
import { EncryptionService } from '../../../common/crypto/encryption.service';

/** Variável derivada do corpo do template ({{1}}, {{2}}…). */
export interface TemplateParameter {
  index: number;
  key: string;
  type: 'text';
  required: boolean;
}

/** Template cru como volta do Graph (campos que consumimos). */
interface GraphTemplate {
  id?: string;
  name: string;
  language: string;
  category?: string;
  status: string;
  components?: any[];
  quality_score?: { score?: string } | string | null;
  rejected_reason?: string | null;
}

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  approved: number;
}

@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Deriva o schema de variáveis do componente BODY ({{1}}, {{2}}…). Puro e
   * testável sem Graph. Sem variáveis → [].
   */
  deriveParameterSchema(components: any[] | null | undefined): TemplateParameter[] {
    const body = (components ?? []).find(
      (c) => String(c?.type ?? '').toUpperCase() === 'BODY',
    );
    const text: string = body?.text ?? '';
    const indices = Array.from(text.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
      parseInt(m[1], 10),
    );
    const unique = Array.from(new Set(indices)).sort((a, b) => a - b);
    return unique.map((i) => ({ index: i, key: String(i), type: 'text', required: true }));
  }

  private qualityToString(q: GraphTemplate['quality_score']): string | null {
    if (!q) return null;
    if (typeof q === 'string') return q;
    return q.score ?? null;
  }

  /** Lista templates aprovados e ativos do canal (escopado por org). */
  async list(
    channelId: string,
    organizationId: string,
    opts: { status?: string } = {},
  ) {
    await this.assertChannelInOrg(channelId, organizationId);
    const status = opts.status ?? 'APPROVED';
    return this.prisma.whatsappTemplate.findMany({
      where: {
        channelId,
        organizationId,
        isActive: true,
        ...(status ? { status } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        components: true,
        parameterSchema: true,
        qualityScore: true,
        syncedAt: true,
      },
    });
  }

  /** Sincroniza os templates do canal a partir do Graph. */
  async sync(channelId: string, organizationId: string): Promise<SyncResult> {
    const channel = await this.assertChannelInOrg(channelId, organizationId);
    if (channel.type !== 'WHATSAPP_OFFICIAL') {
      throw new BadRequestException('Sync de templates só para WhatsApp Oficial.');
    }
    const config = (channel.config ?? {}) as Record<string, any>;
    const wabaId: string | undefined = config.businessAccountId;
    const token = this.encryption.decrypt(config.accessToken) ?? config.accessToken;
    const apiVersion: string = config.apiVersion || 'v21.0';
    if (!wabaId || !token) {
      throw new BadRequestException(
        'Canal sem businessAccountId/accessToken configurados.',
      );
    }

    let fetched: GraphTemplate[];
    try {
      fetched = await this.fetchAllTemplates(wabaId, token, apiVersion);
    } catch (err) {
      // Nunca logar token/config — só o necessário para diagnóstico.
      this.logger.warn(
        `sync templates falhou · channel=${channelId} org=${organizationId} · ${this.safeError(err)}`,
      );
      // Cache anterior permanece intocado (não escrevemos nada antes daqui).
      throw new BadGatewayException('Falha ao consultar templates na Meta.');
    }

    const existing = await this.prisma.whatsappTemplate.findMany({
      where: { channelId },
      select: { id: true, name: true, language: true, isActive: true },
    });
    const existingByKey = new Map(
      existing.map((e) => [`${e.name}::${e.language}`, e]),
    );
    const now = new Date();
    let created = 0;
    let updated = 0;
    let approved = 0;
    const seen = new Set<string>();

    for (const t of fetched) {
      const key = `${t.name}::${t.language}`;
      seen.add(key);
      if (String(t.status ?? '').toUpperCase() === 'APPROVED') approved++;
      const data = {
        organizationId,
        channelId,
        wabaId,
        externalTemplateId: t.id ?? null,
        name: t.name,
        language: t.language,
        category: t.category ?? null,
        status: t.status,
        components: (t.components ?? []) as any,
        parameterSchema: this.deriveParameterSchema(t.components) as any,
        qualityScore: this.qualityToString(t.quality_score),
        rejectedReason: t.rejected_reason ?? null,
        isActive: true,
        deletedAt: null,
        syncedAt: now,
      };
      await this.prisma.whatsappTemplate.upsert({
        where: {
          uq_wa_template_channel_name_lang: {
            channelId,
            name: t.name,
            language: t.language,
          },
        },
        create: data,
        update: data,
      });
      if (existingByKey.has(key)) updated++;
      else created++;
    }

    // Soft-delete dos que sumiram da Meta (e ainda estavam ativos).
    let deactivated = 0;
    for (const e of existing) {
      const key = `${e.name}::${e.language}`;
      if (e.isActive && !seen.has(key)) {
        await this.prisma.whatsappTemplate.update({
          where: { id: e.id },
          data: { isActive: false, deletedAt: now, syncedAt: now },
        });
        deactivated++;
      }
    }

    this.logger.log(
      `sync templates ok · channel=${channelId} org=${organizationId} · total=${fetched.length} created=${created} updated=${updated} deactivated=${deactivated} approved=${approved}`,
    );
    return { total: fetched.length, created, updated, deactivated, approved };
  }

  /** Paginação por cursor do Graph (paging.next). Header Bearer, nunca logado. */
  private async fetchAllTemplates(
    wabaId: string,
    token: string,
    apiVersion: string,
  ): Promise<GraphTemplate[]> {
    const fields =
      'id,name,language,category,status,components,quality_score,rejected_reason';
    let url: string | null = `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates?fields=${fields}&limit=100`;
    const all: GraphTemplate[] = [];
    let guard = 0;
    while (url && guard < 50) {
      guard++;
      const page = await this.fetchPage(url, token);
      all.push(...page.items);
      url = page.next;
    }
    return all;
  }

  /** Busca uma página do Graph. Retorno tipado para evitar inferência circular
   *  com o cursor de paginação. Header Bearer nunca logado. */
  private async fetchPage(
    url: string,
    token: string,
  ): Promise<{ items: GraphTemplate[]; next: string | null }> {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    const payload = (resp.data ?? {}) as {
      data?: GraphTemplate[];
      paging?: { next?: string | null };
    };
    return {
      items: Array.isArray(payload.data) ? payload.data : [],
      next: payload.paging?.next ?? null,
    };
  }

  private async assertChannelInOrg(channelId: string, organizationId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, organizationId },
    });
    if (!channel) throw new NotFoundException('Canal não encontrado.');
    return channel;
  }

  /** Mensagem de erro do Graph sem vazar token/headers/config. */
  private safeError(err: unknown): string {
    const anyErr = err as any;
    return (
      anyErr?.response?.data?.error?.message ??
      anyErr?.message ??
      'erro desconhecido'
    );
  }
}
