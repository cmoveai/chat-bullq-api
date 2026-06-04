import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { PipelinesService } from '../../../pipelines/pipelines.service';
import {
  NodeExecutor,
  NodeExecutionContext,
  NodeExecutionResult,
  NodeAudit,
} from './node-executor.interface';
import { interpolate } from './interpolate.util';

const CONTACT_FIELDS = ['name', 'email', 'phone', 'notes'] as const;

const DRY_RUN_CARD_ACTIONS = ['SET_QUALIFICATION', 'SET_LEAD_SCORE', 'MOVE_CARD_STAGE', 'ASSIGN_AI_AGENT'];

/**
 * ACTION node (Fase 3). Sub-tipo em `data.action` (sem enum novo). Cada ação
 * passa pela camada segura validada (PipelinesService) e devolve `result.audit`
 * — o engine grava o step em chatbot_execution_steps (auditoria centralizada,
 * sem duplicar log). Roda no contexto de tenant (o caller envolve em
 * runWithTenant → RLS).
 *
 *  - SAVE_CONTACT · ADD_TAG · SET_QUALIFICATION · SET_LEAD_SCORE
 *  - MOVE_CARD_STAGE · CREATE_TASK · ASSIGN_AI_AGENT · HANDOFF
 *  - SET_VARIABLE (sessão) · JUMP (goto) — controle de fluxo, rodam em dry_run
 */
@Injectable()
export class ActionNodeExecutor implements NodeExecutor {
  readonly nodeType = 'ACTION';
  private readonly logger = new Logger(ActionNodeExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipelines: PipelinesService,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const result: NodeExecutionResult = {
      nextNodeId: ctx.nodeEdges[0]?.targetNodeId || null,
      sendMessages: [],
      waitForInput: false,
    };

    const action = (ctx.nodeData?.action as string) || 'SAVE_CONTACT';
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { organizationId: true, contactId: true },
    });
    if (!conv) {
      result.audit = { status: 'failed', action, error: 'conversa não encontrada' };
      return result;
    }
    const org = conv.organizationId;
    const reason =
      (typeof ctx.nodeData?.reason === 'string' && ctx.nodeData.reason.trim()) ||
      `chatbot:${ctx.session.flowId}`;

    // Controle de fluxo / estado de sessão — rodam em QUALQUER modo (inclusive
    // dry_run): não mutam o CRM e a simulação precisa seguir o caminho real.
    if (action === 'SET_VARIABLE') {
      const name =
        (typeof ctx.nodeData?.name === 'string' && ctx.nodeData.name.trim()) ||
        (typeof ctx.nodeData?.variable === 'string' && ctx.nodeData.variable.trim()) ||
        '';
      if (!name) {
        result.audit = { status: 'skipped', action, error: 'sem nome de variável' };
        return result;
      }
      const raw = ctx.nodeData?.value;
      const value = typeof raw === 'string' ? interpolate(raw, ctx.session.variables) : raw;
      result.updatedVariables = { [name]: value };
      result.audit = { status: 'success', action, note: `${name}=${String(value)}` };
      return result;
    }

    if (action === 'JUMP') {
      const target =
        (typeof ctx.nodeData?.targetNodeId === 'string' && ctx.nodeData.targetNodeId.trim()) || '';
      if (!target) {
        result.audit = { status: 'skipped', action, error: 'sem targetNodeId' };
        return result; // segue pelo edge normal
      }
      result.nextNodeId = target;
      result.isJump = true;
      result.audit = { status: 'success', action, note: `→ ${target}` };
      return result;
    }

    // Simulação (dry_run): NÃO muta o CRM. Resolve o card só para reportar se a
    // ação teria alvo, e registra 'simulated' (o engine grava o step).
    if (ctx.dryRun) {
      let note: string | undefined;
      const refs: NodeAudit['refs'] = {};
      if (DRY_RUN_CARD_ACTIONS.includes(action)) {
        const card = await this.resolveCard(ctx, org, conv.contactId);
        if (card) refs.cardId = card.id;
        else note = 'sem card (simulado)';
      }
      result.audit = { status: 'simulated', action, refs, note };
      return result;
    }

    try {
      const refs: NodeAudit['refs'] = {};
      let tool: string | undefined;
      switch (action) {
        case 'SAVE_CONTACT':
          refs.contactId = await this.saveContact(ctx, conv.contactId);
          tool = 'contact.update';
          break;
        case 'ADD_TAG': {
          const r = await this.addTag(ctx, org, conv.contactId);
          refs.tagId = r.tagId;
          refs.contactId = r.contactId;
          tool = 'tag.upsert';
          break;
        }
        case 'SET_QUALIFICATION': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra qualificar');
          await this.pipelines.qualifyCard(card.id, org, {
            status: String(ctx.nodeData?.status ?? 'QUALIFIED'),
            reason,
            scoreDelta:
              typeof ctx.nodeData?.scoreDelta === 'number' ? ctx.nodeData.scoreDelta : undefined,
          });
          refs.cardId = card.id;
          tool = 'pipelines.qualifyCard';
          break;
        }
        case 'SET_LEAD_SCORE': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra score');
          await this.pipelines.setLeadScore(card.id, org, {
            score: typeof ctx.nodeData?.score === 'number' ? ctx.nodeData.score : undefined,
            delta: typeof ctx.nodeData?.delta === 'number' ? ctx.nodeData.delta : undefined,
          });
          refs.cardId = card.id;
          tool = 'pipelines.setLeadScore';
          break;
        }
        case 'MOVE_CARD_STAGE': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          if (!card) throw new Error('sem card pra mover');
          const toStageId = String(ctx.nodeData?.toStageId ?? '');
          if (!toStageId) throw new Error('sem toStageId');
          await this.pipelines.moveCard(
            card.id,
            org,
            { toStageId, toIndex: 0 },
            { type: 'SYSTEM', reason, context: { flowId: ctx.session.flowId } },
          );
          refs.cardId = card.id;
          tool = 'pipelines.moveCard';
          break;
        }
        case 'CREATE_TASK': {
          const card = await this.resolveCard(ctx, org, conv.contactId);
          const task = await this.pipelines.createCommercialTask(org, {
            title:
              (typeof ctx.nodeData?.title === 'string' && ctx.nodeData.title.trim()) ||
              'Atividade do flow',
            cardId: card?.id ?? null,
            contactId: conv.contactId,
            conversationId: ctx.conversationId,
            dueDate: this.dueFromHours(ctx.nodeData?.dueInHours),
          });
          refs.taskId = task.id;
          refs.cardId = card?.id ?? null;
          refs.contactId = conv.contactId;
          tool = 'pipelines.createCommercialTask';
          break;
        }
        case 'ASSIGN_AI_AGENT': {
          const r = await this.assignAiAgent(ctx, org, conv.contactId);
          refs.agentId = r.agentId;
          refs.cardId = r.cardId;
          tool = 'conversation.assignAgent';
          break;
        }
        case 'HANDOFF':
          await this.pipelines.handoffToHuman(ctx.conversationId, org, { reason });
          result.transferToHuman = true;
          tool = 'pipelines.handoffToHuman';
          break;
        default:
          this.logger.warn(`Unknown ACTION '${action}' — skipping`);
          result.audit = { status: 'skipped', action, error: 'ação desconhecida' };
          return result;
      }
      result.audit = { status: 'success', action, tool, refs };
    } catch (err: any) {
      this.logger.warn(`ACTION ${action} falhou: ${err?.message}`);
      result.audit = { status: 'failed', action, error: String(err?.message ?? err) };
    }
    return result;
  }

  /**
   * Atribui um agente IA à conversa (e ao card, se houver). NÃO ativa IA
   * pública, NÃO liga o canal, NÃO cria ai_agent_channels e NÃO dispara
   * resposta. O agente precisa pertencer ao tenant (impede agente de outra org
   * / CMOVE no EIXXO). Os allowed_tools governam o que ele faz quando (e se)
   * for executado — aqui nada é executado.
   */
  private async assignAiAgent(
    ctx: NodeExecutionContext,
    org: string,
    contactId: string | null,
  ): Promise<{ agentId: string; cardId: string | null }> {
    const agentId = typeof ctx.nodeData?.agentId === 'string' ? ctx.nodeData.agentId.trim() : '';
    if (!agentId) throw new Error('sem agentId');
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId: org },
      select: { id: true },
    });
    if (!agent) throw new Error('agente não pertence ao tenant');
    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { activeAgentId: agent.id },
    });
    const card = await this.resolveCard(ctx, org, contactId);
    if (card) {
      await this.prisma.card.update({ where: { id: card.id }, data: { sdrAgentId: agent.id } });
    }
    return { agentId: agent.id, cardId: card?.id ?? null };
  }

  private async resolveCard(ctx: NodeExecutionContext, org: string, contactId: string | null) {
    return this.pipelines.resolveCardForContext(org, {
      conversationId: ctx.conversationId,
      contactId,
    });
  }

  private async saveContact(
    ctx: NodeExecutionContext,
    contactId: string | null,
  ): Promise<string | null> {
    const fieldsSpec = (ctx.nodeData?.fields ?? {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const field of CONTACT_FIELDS) {
      const raw = fieldsSpec[field];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = interpolate(raw, ctx.session.variables).trim();
      if (value) data[field] = value;
    }
    if (Object.keys(data).length === 0 || !contactId) return contactId;
    await this.prisma.contact.update({ where: { id: contactId }, data });
    return contactId;
  }

  private async addTag(
    ctx: NodeExecutionContext,
    org: string,
    contactId: string | null,
  ): Promise<{ tagId: string; contactId: string }> {
    const tagName = typeof ctx.nodeData?.tag === 'string' ? ctx.nodeData.tag.trim() : '';
    if (!tagName || !contactId) throw new Error('tag/contato ausente');
    const tag = await this.prisma.tag.upsert({
      where: { organizationId_name: { organizationId: org, name: tagName } },
      update: {},
      create: { organizationId: org, name: tagName },
    });
    await this.prisma.contactTag
      .upsert({
        where: { contactId_tagId: { contactId, tagId: tag.id } },
        update: {},
        create: { contactId, tagId: tag.id },
      })
      .catch(() => undefined);
    return { tagId: tag.id, contactId };
  }

  private dueFromHours(hours: unknown): Date | null {
    const n = typeof hours === 'number' ? hours : Number(hours);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(Date.now() + n * 3600 * 1000);
  }
}
