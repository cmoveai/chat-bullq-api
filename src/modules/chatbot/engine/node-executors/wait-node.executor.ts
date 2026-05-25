import { Injectable } from '@nestjs/common';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';

@Injectable()
export class WaitNodeExecutor implements NodeExecutor {
  readonly nodeType = 'WAIT';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    if (!ctx.incomingMessage) {
      // Pausa esperando a resposta. Só manda mensagem se houver prompt explícito —
      // sem prompt fica silencioso (a pergunta normalmente vem do MESSAGE anterior),
      // evitando filler tipo "Aguardando sua resposta...".
      const prompt = ctx.nodeData.prompt;
      return {
        nextNodeId: null,
        sendMessages: prompt ? [{ type: 'TEXT', content: { text: prompt } }] : [],
        waitForInput: true,
      };
    }

    const variableName = ctx.nodeData.saveAs || 'lastInput';
    const nextNodeId = ctx.nodeEdges[0]?.targetNodeId || null;

    return {
      nextNodeId,
      sendMessages: [],
      waitForInput: false,
      updatedVariables: { [variableName]: ctx.incomingMessage },
    };
  }
}
