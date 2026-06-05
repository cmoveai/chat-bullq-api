import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ChatbotFlowsRepository } from './chatbot-flows.repository';
import { ChatbotExecutionsService } from './chatbot-executions.service';
import { ChatbotEngineService } from '../engine/chatbot-engine.service';
import { ChatbotSessionService } from '../session/chatbot-session.service';

export interface SimulateFlowInput {
  /** Mensagem inicial simulada do contato (entra como incoming no flow). */
  message?: string;
  /** Conversa de teste já existente (do tenant). Se ausente, cria efêmera. */
  conversationId?: string;
  /** Variáveis iniciais da sessão. */
  variables?: Record<string, any>;
  /** true (default) = só simula, NÃO muta o CRM. false = executa pela camada segura. */
  dryRun?: boolean;
}

export interface SimulateStep {
  nodeId: string;
  nodeType: string;
  action: string | null;
  status: string;
  tool: string | null;
  refs: { cardId?: string | null; taskId?: string | null; contactId?: string | null; agentId?: string | null; tagId?: string | null };
  error: string | null;
}

export interface SimulateFlowResult {
  flowId: string;
  executionId: string | null;
  status: 'ended' | 'waiting' | 'error';
  currentNode: string | null;
  dryRun: boolean;
  /** Mensagens que o flow PRODUZIRIA — nunca enviadas a canal real. */
  messages: { type: string; content: Record<string, any>; simulated: true }[];
  /** Histórico completo por nó (chatbot_execution_steps desta run). */
  steps: SimulateStep[];
  /** Trilha de ações (subconjunto de steps com ação: ACTION/DELAY/JUMP). */
  actions: { action: string | null; status: string; node: string | null; error: string | null }[];
  variables: Record<string, any>;
  errors: string[];
  warnings: string[];
  /** Garantia explícita: nenhuma mensagem saiu pra fora. */
  externalSend: false;
}

const SANDBOX_CHANNEL_NAME = '__simulation__';

/**
 * Simulação de chatbot_flows (Fase 3 · Fatia 1.5).
 *
 * Roda um flow de ponta a ponta SEM canal público e SEM envio real: o engine
 * apenas devolve as mensagens (quem enfileira no outbound é o processor — aqui
 * NÃO se enfileira nada). ACTION nodes respeitam `dryRun`: true só registra o
 * que aconteceria; false executa pela mesma camada segura validada. Tudo fica
 * isolado por tenant (RLS via middleware do request) e auditado em
 * chatbot_flow_executions.
 */
@Injectable()
export class ChatbotSimulationService {
  private readonly logger = new Logger(ChatbotSimulationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flowsRepo: ChatbotFlowsRepository,
    private readonly executions: ChatbotExecutionsService,
    private readonly engine: ChatbotEngineService,
    private readonly session: ChatbotSessionService,
  ) {}

  async simulate(
    flowId: string,
    organizationId: string,
    input: SimulateFlowInput,
  ): Promise<SimulateFlowResult> {
    const dryRun = input.dryRun !== false; // default seguro: simula
    const warnings: string[] = [];

    const flow = await this.flowsRepo.findById(flowId);
    if (!flow || flow.deletedAt) throw new NotFoundException('Flow não encontrado');
    if (flow.organizationId !== organizationId) throw new ForbiddenException();
    if (!flow.nodes.length) throw new NotFoundException('Flow sem nós para simular');
    if (!flow.isActive) warnings.push('Flow inativo — simulando assim mesmo (não afeta o público).');

    // Conversa: usa a de teste informada (do tenant) ou cria uma efêmera.
    let conversationId: string;
    let channelId: string;
    let ephemeral = false;
    let ephemeralContactId: string | null = null;

    if (input.conversationId) {
      const conv = await this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, channelId: true, organizationId: true },
      });
      if (!conv || conv.organizationId !== organizationId) {
        throw new ForbiddenException('Conversa de teste não pertence ao tenant');
      }
      conversationId = conv.id;
      channelId = conv.channelId;
    } else {
      const sandbox = await this.ensureSandbox(organizationId);
      conversationId = sandbox.conversationId;
      channelId = sandbox.channelId;
      ephemeralContactId = sandbox.contactId;
      ephemeral = true;
    }

    let status: SimulateFlowResult['status'] = 'ended';
    let messages: SimulateFlowResult['messages'] = [];
    let currentNode: string | null = null;
    let variables: Record<string, any> = input.variables ?? {};
    let executionId: string | null = null;
    const errors: string[] = [];

    try {
      // Monta a sessão direto no START (ignora isActive — simulação testa rascunho).
      const startNode = flow.nodes.find((n) => n.type === 'START') || flow.nodes[0];
      let firstId = startNode.id;
      if (startNode.type === 'START') {
        const edges = startNode.edges as any[];
        firstId = edges?.[0]?.targetNodeId || startNode.id;
      }
      await this.session.create(conversationId, flow.id, firstId);
      if (input.variables && Object.keys(input.variables).length) {
        await this.session.update(conversationId, { variables: input.variables });
      }

      const result = await this.engine.processMessage(
        conversationId,
        channelId,
        'sim',
        input.message ?? '',
        dryRun,
        true, // simulateMode: DELAY é pulado (não espera tempo real)
      );

      messages = result.messages.map((m) => ({
        type: m.type,
        content: m.content,
        simulated: true as const,
      }));
      executionId = result.executionId ?? null;

      // Sessão sobrevive só se o flow pausou esperando input; o estado final das
      // variáveis vem do EngineResult (sobrevive ao destroy no END_FLOW).
      const liveSession = await this.session.get(conversationId);
      currentNode = liveSession?.currentNodeId ?? null;
      variables = result.variables ?? liveSession?.variables ?? variables;
      status = result.sessionEnded ? 'ended' : 'waiting';
    } catch (err: any) {
      this.logger.warn(`Simulação do flow ${flow.id} falhou: ${err?.message}`);
      status = 'error';
      errors.push(String(err?.message ?? err));
    }

    // Histórico por nó (auditoria centralizada — o engine gravou os steps).
    const stepRows = executionId
      ? await this.prisma.chatbotExecutionStep.findMany({
          where: { executionId },
          orderBy: { startedAt: 'asc' },
          select: {
            nodeId: true, nodeType: true, action: true, status: true, tool: true,
            errorMessage: true, cardId: true, taskId: true, contactId: true, agentId: true, tagId: true,
          },
        })
      : [];
    const steps: SimulateStep[] = stepRows.map((s) => ({
      nodeId: s.nodeId, nodeType: s.nodeType, action: s.action, status: s.status, tool: s.tool,
      refs: { cardId: s.cardId, taskId: s.taskId, contactId: s.contactId, agentId: s.agentId, tagId: s.tagId },
      error: s.errorMessage,
    }));
    const actions = steps
      .filter((s) => s.action)
      .map((s) => ({ action: s.action, status: s.status, node: s.nodeId, error: s.error }));
    for (const s of steps) {
      if (s.status === 'failed') errors.push(`${s.action ?? s.nodeType}: ${s.error ?? 'erro'}`);
    }

    // Limpeza: sempre destrói a sessão Redis; remove a conversa efêmera de teste.
    await this.session.destroy(conversationId).catch(() => undefined);
    if (ephemeral) {
      await this.prisma.conversation.delete({ where: { id: conversationId } }).catch(() => undefined);
      if (ephemeralContactId) {
        await this.prisma.contact.delete({ where: { id: ephemeralContactId } }).catch(() => undefined);
      }
    }

    return {
      flowId: flow.id,
      executionId,
      status,
      currentNode,
      dryRun,
      messages,
      steps,
      actions,
      variables,
      errors,
      warnings,
      externalSend: false,
    };
  }

  /**
   * Garante um canal-sandbox interno por tenant (isActive=false, sem Meta) e cria
   * uma conversa+contato efêmeros pra rodar a simulação. O canal é reusável; a
   * conversa/contato são removidos ao fim da simulação.
   */
  private async ensureSandbox(organizationId: string): Promise<{
    channelId: string;
    conversationId: string;
    contactId: string;
  }> {
    let channel = await this.prisma.channel.findFirst({
      where: { organizationId, name: SANDBOX_CHANNEL_NAME, deletedAt: null },
      select: { id: true },
    });
    if (!channel) {
      channel = await this.prisma.channel.create({
        data: {
          organizationId,
          type: 'INSTAGRAM',
          name: SANDBOX_CHANNEL_NAME,
          config: {},
          isActive: false,
          aiEnabled: false,
        },
        select: { id: true },
      });
    }
    const contact = await this.prisma.contact.create({
      data: { organizationId, name: 'Simulação (teste)' },
      select: { id: true },
    });
    const conversation = await this.prisma.conversation.create({
      data: {
        organizationId,
        channelId: channel.id,
        contactId: contact.id,
        status: 'PENDING',
      },
      select: { id: true },
    });
    return { channelId: channel.id, conversationId: conversation.id, contactId: contact.id };
  }
}
