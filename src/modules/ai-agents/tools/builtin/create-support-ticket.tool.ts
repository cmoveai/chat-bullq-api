import { Injectable, Logger } from '@nestjs/common';
import { SupportTicketPriority } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { AiTool, ToolContext, ToolResult } from '../tool.types';

/**
 * Registra um pedido formal do cliente (2ª via, NF, reembolso, suporte
 * técnico fora-do-escopo, etc) numa fila interna que o time humano resolve.
 *
 * Esta tool NÃO executa a ação — apenas REGISTRA o pedido. Os agentes IA
 * NÃO têm capacidade de enviar e-mails, gerar boletos ou fazer baixas
 * sozinhos. Sempre que o cliente pedir uma ação que dependa de sistema
 * externo (financeiro, e-mail, ERP), o agente deve coletar os dados
 * necessários e chamar esta tool. Em seguida responde pro cliente que
 * o pedido foi REGISTRADO e será processado pela equipe.
 */
@Injectable()
export class CreateSupportTicketTool implements AiTool {
  private readonly logger = new Logger(CreateSupportTicketTool.name);

  readonly name = 'createSupportTicket';
  readonly description =
    'Registra um pedido do cliente que precisa de ação humana (2ª via de boleto, segunda via de NF, reembolso, alteração cadastral, suporte técnico complexo). Use SEMPRE que prometer um envio/ação por canal externo — você NÃO tem ferramenta de envio de e-mail nem de geração de documento, então NUNCA afirme que enviou; em vez disso registre o ticket e diga que a equipe responde no prazo.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'briefing'],
    properties: {
      category: {
        type: 'string',
        description:
          'Categoria do pedido. Ex: "segunda-via-boleto", "segunda-via-nf", "reembolso", "alteracao-cadastral", "suporte-tecnico", "outros".',
        minLength: 2,
        maxLength: 60,
      },
      briefing: {
        type: 'string',
        description:
          'Descrição do que o cliente está pedindo + dados já coletados (produto, valor, data da compra, etc). Texto corrido em PT-BR, sem markdown.',
        minLength: 5,
        maxLength: 2000,
      },
      customerEmail: {
        type: 'string',
        description:
          'Email confirmado pelo cliente para receber o retorno. Deixe vazio se não foi coletado.',
        maxLength: 200,
      },
      customerPhone: {
        type: 'string',
        description:
          'Telefone alternativo se cliente forneceu. Deixe vazio se não foi coletado.',
        maxLength: 30,
      },
      priority: {
        type: 'string',
        enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
        description:
          'Prioridade. Default NORMAL. Use HIGH se cliente está bloqueado (não consegue acessar/pagar) e URGENT só se há risco de perda de cliente.',
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const category = String(input.category ?? '').trim().toLowerCase();
    const briefing = String(input.briefing ?? '').trim();
    const customerEmail = input.customerEmail
      ? String(input.customerEmail).trim()
      : null;
    const customerPhone = input.customerPhone
      ? String(input.customerPhone).trim()
      : null;
    const priorityInput = input.priority
      ? String(input.priority).trim().toUpperCase()
      : 'NORMAL';

    if (!category || !briefing) {
      return {
        output: { ok: false, error: 'category and briefing are required' },
      };
    }

    const allowed: SupportTicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    const priority = (
      allowed.includes(priorityInput as SupportTicketPriority)
        ? priorityInput
        : 'NORMAL'
    ) as SupportTicketPriority;

    const ticket = await this.prisma.supportTicket.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        agentId: ctx.agentId,
        category,
        briefing,
        customerEmail,
        customerPhone,
        priority,
        metadata: { runId: ctx.runId, channelId: ctx.channelId },
      },
    });

    await this.prisma.conversationAuditLog.create({
      data: {
        conversationId: ctx.conversationId,
        actorId: null,
        action: 'AI_TICKET_CREATED',
        metadata: {
          ticketId: ticket.id,
          category,
          priority,
          agentId: ctx.agentId,
          runId: ctx.runId,
        },
      },
    });

    this.realtime.emitToConversation(
      ctx.conversationId,
      'support-ticket:created',
      {
        ticketId: ticket.id,
        category,
        priority,
        conversationId: ctx.conversationId,
      },
    );

    this.logger.log(
      `Agent ${ctx.agentId} created support ticket ${ticket.id} (${category}/${priority}) on conv ${ctx.conversationId}`,
    );

    return {
      output: {
        ok: true,
        ticketId: ticket.id,
        category,
        priority,
        message:
          'Ticket registrado. Confirme pro cliente que o pedido foi registrado e a equipe envia o retorno no prazo combinado (2h úteis padrão).',
      },
    };
  }
}
