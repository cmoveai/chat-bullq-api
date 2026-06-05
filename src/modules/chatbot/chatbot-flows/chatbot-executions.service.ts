import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Ações comerciais críticas — por padrão NÃO reexecutam quando um JUMP volta
 * para um nó já executado (allowRepeat=false implícito). Configurável por nó
 * via `data.allowRepeat: true`.
 */
export const CRITICAL_ACTIONS = new Set([
  'MOVE_CARD_STAGE',
  'SET_QUALIFICATION',
  'SET_LEAD_SCORE',
  'CREATE_TASK',
  'HANDOFF',
  'ASSIGN_AI_AGENT',
  'MARK_WON',
  'MARK_LOST',
]);

export interface RecordStepInput {
  flowId: string;
  conversationId: string;
  nodeId: string;
  nodeType: string;
  action?: string | null;
  status: string;
  tool?: string | null;
  input?: any;
  output?: any;
  variablesBefore?: any;
  variablesAfter?: any;
  errorMessage?: string | null;
  cardId?: string | null;
  taskId?: string | null;
  contactId?: string | null;
  agentId?: string | null;
  tagId?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
}

/**
 * Auditoria de execução de chatbot_flows (Fase 3 · Fatia 3).
 * Escreve o RUN (chatbot_flow_executions) + os STEPS (chatbot_execution_steps)
 * e oferece as consultas de observabilidade. Tudo no contexto de tenant (RLS).
 */
@Injectable()
export class ChatbotExecutionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Escrita (recorder) ────────────────────────────────────────────────

  async createRun(
    organizationId: string,
    flowId: string,
    conversationId: string,
    opts: { dryRun?: boolean; triggerSource?: string } = {},
  ): Promise<string | null> {
    const run = await this.prisma.chatbotFlowExecution
      .create({
        data: {
          organizationId,
          flowId,
          conversationId,
          status: 'running',
          dryRun: !!opts.dryRun,
          triggerSource: opts.triggerSource ?? 'inbound',
        },
        select: { id: true },
      })
      .catch(() => null);
    return run?.id ?? null;
  }

  async recordStep(organizationId: string, executionId: string, step: RecordStepInput): Promise<void> {
    await this.prisma.chatbotExecutionStep
      .create({
        data: {
          executionId,
          organizationId,
          flowId: step.flowId,
          conversationId: step.conversationId,
          nodeId: step.nodeId,
          nodeType: step.nodeType,
          action: step.action ?? null,
          status: step.status,
          tool: step.tool ?? null,
          input: step.input ?? undefined,
          output: step.output ?? undefined,
          variablesBefore: step.variablesBefore ?? undefined,
          variablesAfter: step.variablesAfter ?? undefined,
          errorMessage: step.errorMessage ?? null,
          cardId: step.cardId ?? null,
          taskId: step.taskId ?? null,
          contactId: step.contactId ?? null,
          agentId: step.agentId ?? null,
          tagId: step.tagId ?? null,
          startedAt: step.startedAt ?? undefined,
          finishedAt: step.finishedAt ?? undefined,
        },
      })
      .catch(() => undefined);
  }

  async finishRun(
    executionId: string,
    status: string,
    opts: { error?: string | null; currentNode?: string | null; finished?: boolean } = {},
  ): Promise<void> {
    await this.prisma.chatbotFlowExecution
      .update({
        where: { id: executionId },
        data: {
          status,
          error: opts.error ?? undefined,
          currentNode: opts.currentNode ?? undefined,
          finishedAt: opts.finished === false ? undefined : new Date(),
        },
      })
      .catch(() => undefined);
  }

  // ─── Leitura (observabilidade) ─────────────────────────────────────────

  async listByFlow(flowId: string, organizationId: string, limit = 50) {
    return this.prisma.chatbotFlowExecution.findMany({
      where: { flowId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async listByConversation(conversationId: string, organizationId: string, limit = 50) {
    return this.prisma.chatbotFlowExecution.findMany({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async getExecution(executionId: string, organizationId: string) {
    const run = await this.prisma.chatbotFlowExecution.findUnique({
      where: { id: executionId },
      include: { steps: { orderBy: { startedAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Execução não encontrada');
    if (run.organizationId !== organizationId) throw new ForbiddenException();
    return run;
  }

  /** Últimos passos que falharam (com contexto do run). */
  async recentErrors(organizationId: string, limit = 50) {
    return this.prisma.chatbotExecutionStep.findMany({
      where: { organizationId, status: 'failed' },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true, executionId: true, flowId: true, conversationId: true,
        nodeId: true, nodeType: true, action: true, errorMessage: true, createdAt: true,
      },
    });
  }

  /** Nós mais falhos (contagem de steps 'failed' por nó). */
  async failingNodes(organizationId: string, limit = 20) {
    const rows = await this.prisma.chatbotExecutionStep.groupBy({
      by: ['flowId', 'nodeId', 'nodeType', 'action'],
      where: { organizationId, status: 'failed' },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: Math.min(limit, 100),
    });
    return rows.map((r) => ({
      flowId: r.flowId,
      nodeId: r.nodeId,
      nodeType: r.nodeType,
      action: r.action,
      failures: r._count._all,
    }));
  }
}
