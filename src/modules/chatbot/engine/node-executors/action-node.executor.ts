import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from './node-executor.interface';
import { interpolate } from './interpolate.util';

const CONTACT_FIELDS = ['name', 'email', 'phone', 'notes'] as const;

/**
 * ACTION node. Today supports `SAVE_CONTACT`: persists captured variables onto
 * the conversation's Contact. This is what turns a lead-capture chat into an
 * actual contact (Camada 1, modelo 2). Field values are interpolated against
 * the session variables, so `{ name: "{{nome}}", email: "{{email}}" }` writes
 * what the WAIT nodes collected.
 */
@Injectable()
export class ActionNodeExecutor implements NodeExecutor {
  readonly nodeType = 'ACTION';
  private readonly logger = new Logger(ActionNodeExecutor.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const result: NodeExecutionResult = {
      nextNodeId: ctx.nodeEdges[0]?.targetNodeId || null,
      sendMessages: [],
      waitForInput: false,
    };

    const action = (ctx.nodeData?.action as string) || 'SAVE_CONTACT';
    if (action !== 'SAVE_CONTACT') {
      this.logger.warn(`Unknown ACTION '${action}' — skipping`);
      return result;
    }

    const fieldsSpec = (ctx.nodeData?.fields ?? {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const field of CONTACT_FIELDS) {
      const raw = fieldsSpec[field];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = interpolate(raw, ctx.session.variables).trim();
      if (value) data[field] = value;
    }

    if (Object.keys(data).length === 0) return result;

    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: ctx.conversationId },
        select: { contactId: true },
      });
      if (conversation?.contactId) {
        await this.prisma.contact.update({
          where: { id: conversation.contactId },
          data,
        });
        this.logger.log(
          `ACTION SAVE_CONTACT: contact ${conversation.contactId} updated (${Object.keys(data).join(', ')})`,
        );
      }
    } catch (err: any) {
      this.logger.error(`ACTION SAVE_CONTACT failed: ${err.message}`);
    }

    return result;
  }
}
