import { Injectable } from '@nestjs/common';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';
import { interpolate } from './interpolate.util';

@Injectable()
export class MessageNodeExecutor implements NodeExecutor {
  readonly nodeType = 'MESSAGE';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const text = interpolate(ctx.nodeData.message || '', ctx.session.variables);
    const nextNodeId = ctx.nodeEdges[0]?.targetNodeId || null;

    return {
      nextNodeId,
      sendMessages: [{ type: 'TEXT', content: { text } }],
      waitForInput: false,
    };
  }
}
