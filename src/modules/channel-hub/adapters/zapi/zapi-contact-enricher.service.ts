import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { ZapiHttpClient } from './zapi.http-client';

/**
 * Pulls profile picture and best-effort display name for a Z-API contact via
 * GET /chats/{phone}. Lazy: skip if contact.avatarUrl already set, since
 * Z-API plan limits charge per-request.
 */
@Injectable()
export class ZapiContactEnricherService {
  private readonly logger = new Logger(ZapiContactEnricherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpClient: ZapiHttpClient,
  ) {}

  async enrich(channel: Channel, externalContactId: string): Promise<void> {
    try {
      const contactChannel = await this.prisma.contactChannel.findUnique({
        where: {
          uq_contact_channel_external: {
            channelId: channel.id,
            externalId: externalContactId,
          },
        },
        include: { contact: true },
      });
      if (!contactChannel) return;

      if (contactChannel.contact.avatarUrl) return;

      const chat = await this.httpClient.fetchChatMetadata(channel, externalContactId);
      if (!chat) return;

      const avatarUrl: string | undefined =
        chat.image || chat.profileImage || chat.profileImageUrl || undefined;
      const profileName: string | undefined =
        chat.name || chat.chatName || chat.notifyName || undefined;

      if (!avatarUrl && !profileName) return;

      const ccUpdates: Record<string, any> = {};
      if (profileName && profileName !== contactChannel.profileName) {
        ccUpdates.profileName = profileName;
      }
      if (avatarUrl && avatarUrl !== contactChannel.profileAvatarUrl) {
        ccUpdates.profileAvatarUrl = avatarUrl;
      }
      if (Object.keys(ccUpdates).length > 0) {
        await this.prisma.contactChannel.update({
          where: { id: contactChannel.id },
          data: ccUpdates,
        });
      }

      const contactUpdates: Record<string, any> = {};
      if (profileName && !contactChannel.contact.name) {
        contactUpdates.name = profileName;
      }
      if (avatarUrl && !contactChannel.contact.avatarUrl) {
        contactUpdates.avatarUrl = avatarUrl;
      }
      if (Object.keys(contactUpdates).length > 0) {
        await this.prisma.contact.update({
          where: { id: contactChannel.contactId },
          data: contactUpdates,
        });
      }

      this.logger.log(
        `Z-API contact enriched: ${externalContactId} → ${profileName ?? '(no name)'} ${avatarUrl ? '+ avatar' : ''}`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Z-API contact enrichment failed for ${externalContactId}: ${err.message}`,
      );
    }
  }
}
