import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { runWithTenant } from '../../database/tenant-context';

export type SocialInteractionType =
  | 'COMMENT'
  | 'MENTION'
  | 'STORY_REPLY'
  | 'REACTION';

/**
 * Persistência genérica (omnichannel) de interações sociais — comentários,
 * menções, respostas de story e reações de qualquer canal. NÃO é específico
 * de Instagram; o canal é identificado por channelId.
 */
@Injectable()
export class SocialInteractionsService {
  private readonly logger = new Logger(SocialInteractionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava a interação de forma idempotente (UNIQUE channel + external id) e
   * isolada por tenant (runWithTenant → RLS). Best-effort: nunca derruba o
   * webhook se a persistência falhar.
   */
  async record(input: {
    organizationId: string;
    channelId: string;
    interactionType: SocialInteractionType;
    externalInteractionId: string;
    mediaId?: string | null;
    parentId?: string | null;
    fromUsername?: string | null;
    text?: string | null;
    contactId?: string | null;
    conversationId?: string | null;
    matchedKeyword?: string | null;
    rawPayload?: unknown;
  }): Promise<void> {
    try {
      await runWithTenant(input.organizationId, () =>
        this.prisma.socialInteraction.upsert({
          where: {
            uq_social_channel_ext: {
              channelId: input.channelId,
              externalInteractionId: input.externalInteractionId,
            },
          },
          create: {
            organizationId: input.organizationId,
            channelId: input.channelId,
            interactionType: input.interactionType,
            externalInteractionId: input.externalInteractionId,
            mediaId: input.mediaId ?? null,
            parentId: input.parentId ?? null,
            fromUsername: input.fromUsername ?? null,
            text: input.text ?? null,
            contactId: input.contactId ?? null,
            conversationId: input.conversationId ?? null,
            matchedKeyword: input.matchedKeyword ?? null,
            rawPayload: (input.rawPayload ?? {}) as any,
          },
          update: {}, // já existe = idempotente, não sobrescreve
        }),
      );
    } catch (err: any) {
      this.logger.warn(
        `Persistir social_interaction (${input.interactionType} ${input.externalInteractionId}) falhou: ${err?.message}`,
      );
    }
  }
}
