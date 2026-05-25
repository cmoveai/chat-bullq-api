import { Injectable } from '@nestjs/common';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';
import { interpolate } from './interpolate.util';

@Injectable()
export class TransferNodeExecutor implements NodeExecutor {
  readonly nodeType = 'TRANSFER';

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const message = interpolate(
      ctx.nodeData.message || 'Transferindo você para um atendente...',
      ctx.session.variables,
    );
    const departmentId = ctx.nodeData.departmentId;

    return {
      nextNodeId: null,
      sendMessages: [{ type: 'TEXT', content: { text: message } }],
      waitForInput: false,
      transferToHuman: true,
      transferDepartmentId: departmentId,
    };
  }
}
