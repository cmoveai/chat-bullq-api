import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../database/prisma.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/**
 * Devolve as instruções de Pix da CMOVE.AI pra uma parcela específica.
 * NÃO gera QR dinâmico nem fala com gateway — usa a chave Pix CNPJ fixa
 * (CMOVE_PIX_KEY) e instrui o cliente a mandar o comprovante via WhatsApp.
 *
 * Também consulta a parcela no Supabase do CMOVE.AI pra confirmar valor
 * e vencimento (em vez de Silvia inventar).
 */
@Injectable()
export class GetPixPaymentTool implements AiTool {
  private readonly logger = new Logger(GetPixPaymentTool.name);

  readonly name = 'getPixPayment';
  readonly description =
    'Devolve a chave Pix CMOVE.AI + valor + instrução pra uma parcela já identificada via lookupOpenInvoice. Use SEMPRE depois de lookupOpenInvoice — passa o parcelaId que veio na resposta.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['parcelaId'],
    properties: {
      parcelaId: {
        type: 'string',
        description:
          'ID da parcela retornada por lookupOpenInvoice (campo invoices[].parcelaId).',
      },
    },
  };

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private async sbGet<T = any>(path: string): Promise<T[]> {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_ANON_KEY');
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T[];
  }

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const parcelaId = String(input.parcelaId ?? '').trim();
    if (!parcelaId) {
      return { output: { ok: false, error: 'parcelaId é obrigatório' } };
    }

    try {
      const parcelas = await this.sbGet<any>(
        `cliente_servico_parcelas?id=eq.${encodeURIComponent(parcelaId)}&select=id,servico_id,descricao,valor,vencimento,status`,
      );
      if (parcelas.length === 0) {
        return {
          output: {
            ok: false,
            error: 'Parcela não encontrada no sistema financeiro.',
          },
        };
      }
      const parcela = parcelas[0];
      if (parcela.status === 'pago') {
        return {
          output: {
            ok: false,
            error: 'Esta parcela já está marcada como paga no sistema.',
          },
        };
      }

      const pixKey = this.config.get<string>('CMOVE_PIX_KEY') || '66432401000129';
      const pixName =
        this.config.get<string>('CMOVE_PIX_NAME') ||
        'CMOVE INTELIGENCIA ARTIFICIAL LTDA';
      const valorBR = Number(parcela.valor || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      });
      const venc = parcela.vencimento
        ? new Date(parcela.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')
        : '—';

      await this.prisma.conversationAuditLog.create({
        data: {
          conversationId: ctx.conversationId,
          actorId: null,
          action: 'AI_PIX_INSTRUCTION_SENT',
          metadata: {
            parcelaId,
            valor: parcela.valor,
            vencimento: parcela.vencimento,
            agentId: ctx.agentId,
            runId: ctx.runId,
          },
        },
      });

      this.logger.log(
        `getPixPayment parcela=${parcelaId} valor=${valorBR} pra conv ${ctx.conversationId}`,
      );

      return {
        output: {
          ok: true,
          parcelaId,
          valor: parcela.valor,
          valorFormatado: valorBR,
          vencimento: venc,
          descricao: parcela.descricao,
          pix: {
            tipo: 'CNPJ',
            chave: pixKey,
            favorecido: pixName,
          },
          instrucao: `Pix · CNPJ ${pixKey} · ${pixName} · valor ${valorBR} · vencimento ${venc}. Após pagar, manda o comprovante aqui mesmo que a equipe confirma.`,
          message:
            'Use a string em "instrucao" como base da resposta. Adapte o tom natural.',
        },
      };
    } catch (err: any) {
      this.logger.error(`getPixPayment falhou: ${err.message}`);
      return {
        output: {
          ok: false,
          error: `Falha ao buscar parcela: ${err.message}`,
        },
      };
    }
  }
}
