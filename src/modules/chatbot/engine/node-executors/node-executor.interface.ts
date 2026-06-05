import { ChatbotSession } from '../../session/chatbot-session.types';

export interface NodeExecutionContext {
  session: ChatbotSession;
  nodeData: Record<string, any>;
  nodeEdges: { targetNodeId: string; condition?: string }[];
  incomingMessage?: string;
  conversationId: string;
  channelId: string;
  contactExternalId: string;
  /** Simulação: quando true, ACTION nodes NÃO mutam o CRM — só registram o
   *  que teria acontecido (status 'simulated'). Nada externo é enviado. */
  dryRun?: boolean;
}

export interface NodeExecutionResult {
  nextNodeId: string | null;
  sendMessages: { type: string; content: Record<string, any> }[];
  waitForInput: boolean;
  updatedVariables?: Record<string, any>;
  transferToHuman?: boolean;
  transferDepartmentId?: string;
  /** JUMP/goto: o nextNodeId é um salto explícito (conta pro loop-guard). */
  isJump?: boolean;
  /** Auditoria do nó (ACTION): o engine grava o step a partir disto. */
  audit?: NodeAudit;
}

export interface NodeAudit {
  status: 'success' | 'failed' | 'skipped' | 'simulated';
  action?: string;
  /** Tool/camada segura acionada (ex.: pipelines.moveCard). */
  tool?: string;
  refs?: {
    cardId?: string | null;
    taskId?: string | null;
    contactId?: string | null;
    agentId?: string | null;
    tagId?: string | null;
  };
  error?: string;
  note?: string;
}

export interface NodeExecutor {
  readonly nodeType: string;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}
