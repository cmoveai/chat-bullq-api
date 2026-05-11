import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/**
 * Consulta o Supabase do admin CMOVE.AI pra encontrar parcelas em aberto
 * (pendente ou atrasada) de um cliente, identificando-o por email ou
 * telefone. Devolve a lista pra Silvia (ou outro WORKER financeiro)
 * usar antes de prometer 2ª via / Pix / pagamento.
 *
 * Schema Supabase usado:
 * - clientes(id, nome, empresa, email, telefone)
 * - cliente_servicos(id, cliente_id, servico)
 * - cliente_servico_parcelas(id, servico_id, valor, vencimento, status)
 *   status ∈ {'pendente','pago'} · 'atrasado' = pendente && vencimento < hoje
 */
@Injectable()
export class LookupOpenInvoiceTool implements AiTool {
  private readonly logger = new Logger(LookupOpenInvoiceTool.name);

  readonly name = 'lookupOpenInvoice';
  readonly description =
    'Consulta as parcelas em aberto (pendentes ou atrasadas) de um cliente do CMOVE.AI por email ou telefone. Use SEMPRE antes de prometer 2ª via, Pix ou cobrar — assim você confirma valor e produto reais em vez de adivinhar. Se não achar nada, escala via createSupportTicket.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    properties: {
      email: {
        type: 'string',
        description:
          'Email cadastrado do cliente. Forneça quando o cliente confirmar.',
      },
      phone: {
        type: 'string',
        description:
          'Telefone do cliente, sem máscara, com DDI+DDD se possível (ex: 5511989749229). Use como fallback quando não tiver email.',
      },
    },
  };

  constructor(private readonly config: ConfigService) {}

  private async sb<T = any>(path: string): Promise<T[]> {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_ANON_KEY');
    if (!url || !key) {
      throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY ausentes no env');
    }
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
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
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const email = input.email ? String(input.email).trim().toLowerCase() : '';
    const phoneRaw = input.phone ? String(input.phone).trim() : '';
    const phone = phoneRaw.replace(/\D/g, '');

    if (!email && !phone) {
      return {
        output: { ok: false, error: 'Informe email OU telefone do cliente.' },
      };
    }

    try {
      let clientes: any[] = [];
      if (email) {
        clientes = await this.sb(
          `clientes?email=eq.${encodeURIComponent(email)}&select=id,nome,empresa,email,telefone`,
        );
      }
      if (clientes.length === 0 && phone) {
        // Match relaxado por sufixo do telefone (DDD+numero)
        const sufixo = phone.slice(-10);
        clientes = await this.sb(
          `clientes?telefone=ilike.*${sufixo}*&select=id,nome,empresa,email,telefone`,
        );
      }

      if (clientes.length === 0) {
        return {
          output: {
            ok: true,
            found: false,
            message:
              'Nenhum cliente encontrado com esse email/telefone no sistema financeiro.',
          },
        };
      }

      const cliente = clientes[0];
      const servicos = await this.sb<any>(
        `cliente_servicos?cliente_id=eq.${cliente.id}&select=id,servico`,
      );
      if (servicos.length === 0) {
        return {
          output: {
            ok: true,
            found: true,
            cliente: {
              id: cliente.id,
              nome: cliente.nome,
              empresa: cliente.empresa,
            },
            invoices: [],
            message: 'Cliente encontrado, mas sem serviços cadastrados.',
          },
        };
      }

      const servicoIds = servicos.map((s: any) => s.id);
      const svcMap = new Map(servicos.map((s: any) => [s.id, s.servico]));
      const inList = `(${servicoIds.join(',')})`;
      const parcelas = await this.sb<any>(
        `cliente_servico_parcelas?servico_id=in.${inList}&status=in.(pendente,atrasado)&select=id,servico_id,descricao,valor,vencimento,status&order=vencimento.asc`,
      );

      const hoje = new Date().toISOString().slice(0, 10);
      const invoices = parcelas.map((p: any) => ({
        parcelaId: p.id,
        produto: svcMap.get(p.servico_id) ?? 'Serviço CMOVE.AI',
        descricao: p.descricao || null,
        valor: Number(p.valor || 0),
        vencimento: p.vencimento,
        statusReal:
          p.status === 'pendente' && p.vencimento && p.vencimento < hoje
            ? 'atrasado'
            : p.status || 'pendente',
      }));

      this.logger.log(
        `lookupOpenInvoice ${email || phone}: cliente=${cliente.nome} parcelas=${invoices.length}`,
      );

      return {
        output: {
          ok: true,
          found: true,
          cliente: {
            id: cliente.id,
            nome: cliente.nome,
            empresa: cliente.empresa,
            email: cliente.email,
          },
          invoices,
          message:
            invoices.length === 0
              ? 'Cliente encontrado, sem parcelas em aberto.'
              : `${invoices.length} parcela(s) em aberto. Use getPixPayment(parcelaId) pra gerar instrução de Pix.`,
        },
      };
    } catch (err: any) {
      this.logger.error(`lookupOpenInvoice falhou: ${err.message}`);
      return {
        output: {
          ok: false,
          error: `Falha ao consultar financeiro: ${err.message}. Registre via createSupportTicket pra equipe humana resolver.`,
        },
      };
    }
  }
}
