import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const TEMPLATE_NAME = 'cobranca_pix_marcela';
const TEMPLATE_LANG = 'pt_BR';
const ADMIN_PHONE = '5511943464000';

export interface CobrancaForNotice {
  slug: string;
  clienteNome: string;
  clienteTelefone?: string | null;
  etapa: string;
  valor: number | string;
  vencimento: Date | string;
  pixChave: string;
  pixEmv?: string | null;
}

export type WaSendResult =
  | { ok: true; channel: 'template' | 'text' | 'admin'; messageId?: string }
  | { ok: false; reason: string; fallbackUrl?: string };

@Injectable()
export class CobrancasWhatsappService {
  private readonly logger = new Logger(CobrancasWhatsappService.name);

  constructor(private readonly config: ConfigService) {}

  private getCreds() {
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const apiVersion = this.config.get<string>('WHATSAPP_API_VERSION') ?? 'v21.0';
    return { token, phoneNumberId, apiVersion };
  }

  /**
   * Tenta disparar notificação automática da cobrança recém-criada.
   * Estratégia: template aprovado pelo Meta · cai pra texto livre · cai pra fallback wa.me.
   * Sempre retorna · nunca lança exception (best-effort · não bloqueia criação).
   */
  async sendCobrancaCreated(c: CobrancaForNotice, publicLink: string): Promise<WaSendResult> {
    if (!c.clienteTelefone) {
      return { ok: false, reason: 'sem telefone cadastrado' };
    }
    const to = onlyDigits(c.clienteTelefone);
    if (to.length < 10) {
      return { ok: false, reason: 'telefone inválido' };
    }
    const valorFmt = formatBrl(Number(c.valor));
    const fallbackUrl = `https://wa.me/${to}?text=${encodeURIComponent(
      `Oi ${c.clienteNome}, segue cobrança "${c.etapa}" no valor de ${valorFmt}. Pagamento: ${publicLink}`,
    )}`;

    const { token, phoneNumberId } = this.getCreds();
    if (!token || !phoneNumberId) {
      return { ok: false, reason: 'credenciais WHATSAPP ausentes no env', fallbackUrl };
    }

    // 1. tenta template
    const tplResult = await this.tryTemplate({
      to,
      cliente: c.clienteNome,
      etapa: c.etapa,
      valorFmt,
      link: publicLink,
    });
    if (tplResult.ok) return tplResult;

    // 2. texto livre (só funciona se janela 24h aberta)
    const txtResult = await this.tryText(
      to,
      `Oi ${c.clienteNome}, passando pra te lembrar da cobrança "${c.etapa}" no valor de ${valorFmt}.\nLink de pagamento: ${publicLink}`,
    );
    if (txtResult.ok) return txtResult;

    // 3. fallback · UI mostra link wa.me
    return {
      ok: false,
      reason: `template falhou (${tplResult.reason}); texto livre falhou (${txtResult.reason})`,
      fallbackUrl,
    };
  }

  /**
   * Notifica Cris (admin) via WhatsApp quando algo importante acontece (ex: cliente clicou "Já paguei").
   * Texto livre · janela está sempre aberta com Cris (ela já interagiu com o número).
   */
  async notifyAdmin(message: string): Promise<WaSendResult> {
    return this.tryText(ADMIN_PHONE, message);
  }

  // ─── primitivas ─────────────────────────────────────────────────────────

  private async tryTemplate(p: {
    to: string;
    cliente: string;
    etapa: string;
    valorFmt: string;
    link: string;
  }): Promise<WaSendResult> {
    const { token, phoneNumberId, apiVersion } = this.getCreds();
    try {
      const { data } = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: p.to,
          type: 'template',
          template: {
            name: TEMPLATE_NAME,
            language: { code: TEMPLATE_LANG },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: p.cliente },
                  { type: 'text', text: p.etapa },
                  { type: 'text', text: p.valorFmt },
                  { type: 'text', text: p.link },
                ],
              },
            ],
          },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        },
      );
      const messageId = data?.messages?.[0]?.id;
      this.logger.log(`Template ${TEMPLATE_NAME} disparado pra ${p.to} · id=${messageId}`);
      return { ok: true, channel: 'template', messageId };
    } catch (err) {
      const reason = extractError(err);
      this.logger.warn(`Template ${TEMPLATE_NAME} falhou pra ${p.to}: ${reason}`);
      return { ok: false, reason };
    }
  }

  private async tryText(to: string, text: string): Promise<WaSendResult> {
    const { token, phoneNumberId, apiVersion } = this.getCreds();
    if (!token || !phoneNumberId) {
      return { ok: false, reason: 'credenciais WHATSAPP ausentes' };
    }
    try {
      const { data } = await axios.post(
        `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        },
      );
      const messageId = data?.messages?.[0]?.id;
      this.logger.log(`Texto livre disparado pra ${to} · id=${messageId}`);
      return { ok: true, channel: 'text', messageId };
    } catch (err) {
      const reason = extractError(err);
      this.logger.warn(`Texto livre falhou pra ${to}: ${reason}`);
      return { ok: false, reason };
    }
  }
}

function onlyDigits(s: string): string {
  return s.replace(/\D/g, '');
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value);
}

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const meta = err.response?.data?.error;
    if (meta) {
      return `${meta.code ?? '?'}/${meta.error_subcode ?? '?'} · ${meta.message ?? meta.error_user_msg ?? 'erro Meta'}`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
