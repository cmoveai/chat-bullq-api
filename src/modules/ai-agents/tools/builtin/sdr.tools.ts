import { Injectable } from '@nestjs/common';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { SdrToolkitService } from './sdr-toolkit.service';

/**
 * Tools do SDR (agente IA) para operar a oportunidade comercial (card) com
 * segurança total: todas chamam a camada validada (PipelinesService) e gravam
 * auditoria em sdr_action_log. Toda ação exige `reason`. Ganho/perda exigem
 * motivo (vira closed_reason); follow-up exige data; nada move sem motivo.
 */

const REASON_PROP = {
  reason: {
    type: 'string',
    minLength: 3,
    maxLength: 400,
    description: 'Motivo/contexto da ação (obrigatório, vira auditoria).',
  },
} as const;

@Injectable()
export class QualifyLeadTool implements AiTool {
  readonly name = 'qualifyLead';
  readonly description =
    'Qualifica ou desqualifica o lead da conversa atual (define qualification_status do card). Opcionalmente soma pontos no lead score. Use quando tiver sinais claros (orçamento, autoridade, necessidade, urgência).';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'reason'],
    properties: {
      status: {
        type: 'string',
        enum: ['NEW', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED'],
        description: 'Novo status de qualificação.',
      },
      scoreDelta: {
        type: 'number',
        description: 'Opcional: pontos a somar no lead score (ex: 30).',
      },
      ...REASON_PROP,
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      output: await this.sdr.qualifyLead(ctx, {
        status: String(input.status ?? ''),
        reason: input.reason,
        scoreDelta: typeof input.scoreDelta === 'number' ? input.scoreDelta : undefined,
      }),
    };
  }
}

@Injectable()
export class MoveCardStageTool implements AiTool {
  readonly name = 'moveCardStage';
  readonly description =
    'Move o card (oportunidade) da conversa para outra etapa do funil. Exige o id da etapa de destino e um motivo. Mover para etapa do tipo ganho/perda fecha o card.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['toStageId', 'reason'],
    properties: {
      toStageId: { type: 'string', description: 'ID da etapa de destino.' },
      ...REASON_PROP,
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      output: await this.sdr.moveCardStage(ctx, {
        toStageId: String(input.toStageId ?? ''),
        reason: input.reason,
      }),
    };
  }
}

@Injectable()
export class SetLeadScoreTool implements AiTool {
  readonly name = 'setLeadScore';
  readonly description =
    'Define (score) ou ajusta (delta) o lead score do card. Use score para fixar um valor, delta para somar/subtrair.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      score: { type: 'number', description: 'Valor absoluto (>=0).' },
      delta: { type: 'number', description: 'Ajuste relativo (ex: +20, -10).' },
      ...REASON_PROP,
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      output: await this.sdr.setLeadScore(ctx, {
        score: typeof input.score === 'number' ? input.score : undefined,
        delta: typeof input.delta === 'number' ? input.delta : undefined,
        reason: input.reason,
      }),
    };
  }
}

@Injectable()
export class ScheduleFollowupTool implements AiTool {
  readonly name = 'scheduleFollowup';
  readonly description =
    'Agenda um follow-up para o card: marca next_followup_at e cria uma task comercial. Exige uma data (inHours a partir de agora, ou at em ISO).';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      inHours: { type: 'number', description: 'Daqui a quantas horas (ex: 24, 72).' },
      at: { type: 'string', description: 'Data/hora ISO 8601 (alternativa a inHours).' },
      note: { type: 'string', maxLength: 200, description: 'Nota do follow-up (vira título da task).' },
      ...REASON_PROP,
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      output: await this.sdr.scheduleFollowup(ctx, {
        inHours: typeof input.inHours === 'number' ? input.inHours : undefined,
        at: typeof input.at === 'string' ? input.at : undefined,
        note: typeof input.note === 'string' ? input.note : undefined,
        reason: input.reason,
      }),
    };
  }
}

@Injectable()
export class CreateTaskTool implements AiTool {
  readonly name = 'createCommercialTask';
  readonly description =
    'Cria uma task/atividade comercial ligada ao card/contato da conversa (ex: "Enviar proposta", "Ligar amanhã"). Opcionalmente com prazo.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'reason'],
    properties: {
      title: { type: 'string', minLength: 2, maxLength: 180, description: 'O que precisa ser feito.' },
      dueInHours: { type: 'number', description: 'Opcional: prazo em horas a partir de agora.' },
      ...REASON_PROP,
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      output: await this.sdr.createTask(ctx, {
        title: String(input.title ?? ''),
        dueInHours: typeof input.dueInHours === 'number' ? input.dueInHours : undefined,
        reason: input.reason,
      }),
    };
  }
}

@Injectable()
export class RequestHumanHandoffTool implements AiTool {
  readonly name = 'requestHumanHandoff';
  readonly description =
    'Transfere a conversa para um atendente humano (pausa a IA, abre task de atendimento). Use quando o lead pede humano, há objeção sensível, ou foge do seu escopo.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: { ...REASON_PROP },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const output = await this.sdr.requestHumanHandoff(ctx, { reason: input.reason });
    return { output, finalAction: 'TRANSFERRED_TO_HUMAN' };
  }
}

@Injectable()
export class MarkWonTool implements AiTool {
  readonly name = 'markWon';
  readonly description =
    'Marca a oportunidade como GANHA: move o card para a etapa de ganho do funil e registra o motivo (closed_reason). Use quando o negócio fechar.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        minLength: 3,
        maxLength: 400,
        description: 'Motivo do ganho (vira closed_reason — obrigatório).',
      },
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return { output: await this.sdr.markWon(ctx, { reason: input.reason }) };
  }
}

@Injectable()
export class MarkLostTool implements AiTool {
  readonly name = 'markLost';
  readonly description =
    'Marca a oportunidade como PERDIDA: move o card para a etapa de perda do funil e registra o motivo (closed_reason). Use quando o lead desistir/sumir/não fechar.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        minLength: 3,
        maxLength: 400,
        description: 'Motivo da perda (vira closed_reason — obrigatório).',
      },
    },
  };
  constructor(private readonly sdr: SdrToolkitService) {}
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return { output: await this.sdr.markLost(ctx, { reason: input.reason }) };
  }
}
