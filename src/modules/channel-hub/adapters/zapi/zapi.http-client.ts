import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

/**
 * Z-API adapter.
 *
 * Z-API authenticates via path: every request goes to
 *   https://api.z-api.io/instances/{INSTANCE_ID}/token/{TOKEN}/{action}
 *
 * The optional `Client-Token` header is a second-factor for accounts that
 * enabled "Account security" — we forward it when present in channel.config.
 *
 * channel.config shape:
 *   {
 *     instanceId: string;
 *     token: string;
 *     clientToken?: string; // optional account-level security token
 *   }
 */
@Injectable()
export class ZapiHttpClient {
  private static readonly BASE_URL = 'https://api.z-api.io';
  private readonly logger = new Logger(ZapiHttpClient.name);

  private createClient(channel: Channel): AxiosInstance {
    const config = channel.config as Record<string, any>;
    const instanceId = config.instanceId;
    const token = config.token;
    if (!instanceId || !token) {
      throw new Error(
        'Z-API channel.config requires both instanceId and token',
      );
    }
    const headers: Record<string, string> = {};
    if (config.clientToken) {
      headers['Client-Token'] = config.clientToken;
    }
    this.logger.log(
      `Z-API createClient · channel=${channel.name} · instanceId=${instanceId} · tokenLen=${String(token).length} · clientToken=${config.clientToken ? 'SET(' + String(config.clientToken).length + ')' : 'EMPTY'} · url=${ZapiHttpClient.BASE_URL}/instances/${instanceId}/token/${String(token).slice(0, 4)}…${String(token).slice(-4)}`,
    );
    return axios.create({
      baseURL: `${ZapiHttpClient.BASE_URL}/instances/${instanceId}/token/${token}`,
      headers,
      timeout: 30000,
    });
  }

  async sendRequest(
    channel: Channel,
    endpoint: string,
    payload: Record<string, any>,
  ): Promise<any> {
    const client = this.createClient(channel);
    try {
      const response = await client.post(endpoint, payload);
      return response.data;
    } catch (error: any) {
      this.logger.error(
        `Z-API error: ${endpoint} - ${error.response?.data?.message || error.response?.data?.error || error.message}`,
      );
      throw error;
    }
  }

  async getInstanceStatus(channel: Channel): Promise<any> {
    const config = channel.config as Record<string, any>;
    const instanceId = String(config.instanceId || '');
    const token = String(config.token || '');
    this.logger.log(
      `Z-API status check · instanceId len=${instanceId.length} prefix=${instanceId.slice(0, 6)} · token len=${token.length} prefix=${token.slice(0, 4)}`,
    );
    const client = this.createClient(channel);
    try {
      const response = await client.get('/status');
      return response.data;
    } catch (error: any) {
      const respData = error.response?.data;
      this.logger.error(
        `Z-API status check failed (${error.response?.status}): ${typeof respData === 'string' ? respData : JSON.stringify(respData)} · message: ${error.message}`,
      );
      throw error;
    }
  }

  async fetchChats(
    channel: Channel,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<any> {
    const client = this.createClient(channel);
    const params = {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 50,
    };
    try {
      const response = await client.get('/chats', { params });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Z-API fetchChats failed: ${error.message}`);
      throw error;
    }
  }

  async fetchMessages(
    channel: Channel,
    phoneNumber: string,
    page = 1,
    pageSize = 50,
  ): Promise<any> {
    const client = this.createClient(channel);
    const clean = phoneNumber.replace(/@s\.whatsapp\.net|@g\.us|@c\.us/g, '');
    try {
      const response = await client.get(`/chat-messages/${clean}`, {
        params: { page, pageSize },
      });
      return response.data;
    } catch (error: any) {
      this.logger.error(`Z-API fetchMessages failed: ${error.message}`);
      throw error;
    }
  }

  async fetchChatMetadata(
    channel: Channel,
    phoneNumber: string,
  ): Promise<any | null> {
    const client = this.createClient(channel);
    const clean = phoneNumber.replace(/@s\.whatsapp\.net|@g\.us|@c\.us/g, '');
    try {
      const response = await client.get(`/chats/${clean}`);
      return response.data;
    } catch (error: any) {
      this.logger.warn(`Z-API fetchChatMetadata failed for ${clean}: ${error.message}`);
      return null;
    }
  }

  async configureWebhooks(
    channel: Channel,
    url: string,
  ): Promise<void> {
    const client = this.createClient(channel);
    // Z-API has separate endpoints per event type. We point all of them at the
    // same URL so a single webhook receiver in our API handles everything.
    const endpoints = [
      '/update-webhook-received',         // ao receber
      '/update-webhook-delivery',          // delivery / status
      '/update-webhook-message-status',    // alt name in some firmware
      '/update-webhook-disconnected',
      '/update-webhook-connected',
      '/update-webhook-presence',
      '/update-webhook-receive-all-notifications',
    ];
    await Promise.all(
      endpoints.map((ep) =>
        client
          .put(ep, { value: url })
          .catch((err: any) =>
            this.logger.warn(
              `Z-API ${ep} failed: ${err.response?.data?.error || err.message}`,
            ),
          ),
      ),
    );
  }

  async getMediaBuffer(channel: Channel, mediaUrl: string): Promise<Buffer> {
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  /**
   * Z-API delivers inbound media as a public URL on its CDN already (no .enc
   * trick like Uazapi). The webhook payload carries imageUrl/audioUrl/etc
   * directly. So `resolveInboundMediaUrl` is a no-op fallback — if the
   * caller still asks for it, we just echo back the externalMessageId-derived
   * URL by hitting Z-API's message-by-id endpoint.
   */
  async resolveInboundMediaUrl(
    channel: Channel,
    externalMessageId: string,
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    const client = this.createClient(channel);
    try {
      const response = await client.get(`/messages/${externalMessageId}`);
      const data = response.data;
      const fileUrl =
        data?.image?.imageUrl ||
        data?.audio?.audioUrl ||
        data?.video?.videoUrl ||
        data?.document?.documentUrl ||
        data?.sticker?.stickerUrl ||
        data?.fileUrl;
      if (!fileUrl) {
        throw new Error(`Z-API messages/${externalMessageId} returned no media URL`);
      }
      return { fileUrl, mimeType: data?.mimeType };
    } catch (error: any) {
      this.logger.error(`Z-API resolveInboundMediaUrl failed: ${error.message}`);
      throw error;
    }
  }
}
