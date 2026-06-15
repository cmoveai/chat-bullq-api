import { Logger } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { WhatsAppOnboardingService } from '../whatsapp-onboarding/whatsapp-onboarding.service';

/**
 * Cobre o fechamento da falha silenciosa do subscribed_apps no onboarding
 * WhatsApp Official: subscribe centralizado, falha visível (config +
 * connectionStatus), /test reexecuta e reconexão reexecuta. Mocka o Graph
 * (waOfficialHttpClient) — nenhuma chamada real à Meta.
 */

const SECRET = 'enc:v1:NUNCA_LOGAR_ESTE_TOKEN';

function makeChannelsService(over: {
  channel?: any;
  subscribeApp?: jest.Mock;
  verifyPhoneNumber?: jest.Mock;
}) {
  const repository = {
    findById: jest.fn().mockResolvedValue(over.channel ?? null),
    update: jest.fn().mockImplementation((id: string, data: any) => ({
      id,
      ...data,
    })),
  };
  const waOfficialHttpClient = {
    subscribeApp: over.subscribeApp ?? jest.fn().mockResolvedValue({ success: true }),
    verifyPhoneNumber:
      over.verifyPhoneNumber ??
      jest.fn().mockResolvedValue({
        display_phone_number: '+55 11 90000-0000',
        quality_rating: 'GREEN',
        verified_name: 'Test',
      }),
  };
  // Posições não usadas pelos métodos sob teste entram como undefined.
  const svc = new (ChannelsService as any)(
    repository,
    undefined,
    undefined,
    undefined,
    waOfficialHttpClient,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  return { svc, repository, waOfficialHttpClient };
}

describe('ChannelsService.ensureWaOfficialSubscription', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('marca subscribed e limpa erro quando o subscribe funciona', async () => {
    const channel = {
      id: 'c1',
      config: { businessAccountId: 'WABA1', accessToken: SECRET },
    };
    const { svc, repository, waOfficialHttpClient } = makeChannelsService({
      channel,
    });

    const res = await svc.ensureWaOfficialSubscription('c1');

    expect(res).toEqual({ subscribed: true });
    expect(waOfficialHttpClient.subscribeApp).toHaveBeenCalledWith(channel);
    const saved = repository.update.mock.calls[0][1].config;
    expect(saved.subscriptionStatus).toBe('subscribed');
    expect(saved.subscribedAt).toBeDefined();
    expect(saved.lastSubscribeError).toBeUndefined();
  });

  it('marca failed e registra o erro quando o subscribe falha (não lança)', async () => {
    const channel = {
      id: 'c1',
      config: { businessAccountId: 'WABA1', accessToken: SECRET },
    };
    const subscribeApp = jest
      .fn()
      .mockRejectedValue({ response: { data: { error: { message: 'boom' } } } });
    const { svc, repository } = makeChannelsService({ channel, subscribeApp });

    const res = await svc.ensureWaOfficialSubscription('c1');

    expect(res).toEqual({ subscribed: false, error: 'boom' });
    const saved = repository.update.mock.calls[0][1].config;
    expect(saved.subscriptionStatus).toBe('failed');
    expect(saved.lastSubscribeError).toBe('boom');
  });

  it('marca failed quando falta businessAccountId, sem chamar o Graph', async () => {
    const channel = { id: 'c1', config: { accessToken: SECRET } };
    const { svc, repository, waOfficialHttpClient } = makeChannelsService({
      channel,
    });

    const res = await svc.ensureWaOfficialSubscription('c1');

    expect(res.subscribed).toBe(false);
    expect(res.error).toBe('missing businessAccountId');
    expect(waOfficialHttpClient.subscribeApp).not.toHaveBeenCalled();
    expect(repository.update.mock.calls[0][1].config.subscriptionStatus).toBe(
      'failed',
    );
  });

  it('nunca expõe o token salvo (config.accessToken) em logs ou no retorno', async () => {
    const channel = {
      id: 'c1',
      config: { businessAccountId: 'WABA1', accessToken: SECRET },
    };
    // Erro realista do Graph (não contém o token) — o invariante é que o token
    // armazenado no config nunca apareça em log nem no retorno.
    const subscribeApp = jest
      .fn()
      .mockRejectedValue({
        response: { data: { error: { message: '(#10) permission denied' } } },
      });
    const { svc } = makeChannelsService({ channel, subscribeApp });

    const res = await svc.ensureWaOfficialSubscription('c1');

    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .join(' ');
    expect(logged).not.toContain('NUNCA_LOGAR_ESTE_TOKEN');
    expect(JSON.stringify(res)).not.toContain('NUNCA_LOGAR_ESTE_TOKEN');
  });
});

describe('ChannelsService.testConnection (WHATSAPP_OFFICIAL) reexecuta o subscribe', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('subscribe ok → connected', async () => {
    const channel = {
      id: 'c1',
      type: ChannelType.WHATSAPP_OFFICIAL,
      config: { businessAccountId: 'WABA1', accessToken: SECRET },
    };
    const { svc, repository, waOfficialHttpClient } = makeChannelsService({
      channel,
    });
    jest.spyOn(svc as any, 'findOne').mockResolvedValue(channel);

    const res = await svc.testConnection('c1', 'org1');

    expect(waOfficialHttpClient.subscribeApp).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.status).toBe('connected');
    expect(res.data.subscriptionStatus).toBe('subscribed');
    const statusUpdate = repository.update.mock.calls.find(
      (c: any[]) => c[1].connectionStatus,
    );
    expect(statusUpdate[1].connectionStatus).toBe('connected');
  });

  it('subscribe falha → needs_review (não mente "connected")', async () => {
    const channel = {
      id: 'c1',
      type: ChannelType.WHATSAPP_OFFICIAL,
      config: { businessAccountId: 'WABA1', accessToken: SECRET },
    };
    const subscribeApp = jest.fn().mockRejectedValue(new Error('no scope'));
    const { svc, repository } = makeChannelsService({ channel, subscribeApp });
    jest.spyOn(svc as any, 'findOne').mockResolvedValue(channel);

    const res = await svc.testConnection('c1', 'org1');

    expect(res.success).toBe(false);
    expect(res.status).toBe('needs_review');
    const statusUpdate = repository.update.mock.calls.find(
      (c: any[]) => c[1].connectionStatus,
    );
    expect(statusUpdate[1].connectionStatus).toBe('needs_review');
  });
});

describe('WhatsAppOnboardingService.connect reexecuta subscribe nos dois caminhos', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    process.env = { ...OLD_ENV, META_APP_ID: 'app', META_APP_SECRET: 'sec' };
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = OLD_ENV;
  });

  function makeOnboarding(opts: {
    existing?: any;
    registered?: boolean;
    subscribed?: boolean;
  }) {
    const prisma = {
      channel: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        update: jest
          .fn()
          .mockImplementation(({ where, data }: any) => ({ id: where.id, ...data })),
      },
    };
    const ensureWaOfficialSubscription = jest
      .fn()
      .mockResolvedValue({ subscribed: opts.subscribed ?? true });
    const channels = {
      create: jest.fn().mockResolvedValue({ id: 'newChan' }),
      ensureWaOfficialSubscription,
      enrichProviderIds: jest.fn().mockResolvedValue(undefined),
    };
    const encryption = { encrypt: (v: string) => `enc:${v}` };
    const svc = new (WhatsAppOnboardingService as any)(prisma, channels, encryption);
    // Stub dos métodos privados que falam com o Graph — nenhuma chamada real.
    jest.spyOn(svc as any, 'exchangeCodeForToken').mockResolvedValue('CLIENT_TOKEN');
    jest
      .spyOn(svc as any, 'registerPhoneNumber')
      .mockResolvedValue(opts.registered ?? true);
    jest.spyOn(svc as any, 'fetchDisplayName').mockResolvedValue('Cliente');
    return { svc, prisma, channels };
  }

  const dto = { code: 'x', wabaId: 'WABA1', phoneNumberId: 'PN1' };

  it('canal novo: create com skipAutoSubscribe + subscribe explícito → connected', async () => {
    const { svc, channels } = makeOnboarding({ subscribed: true });

    await svc.connect('org1', dto as any);

    expect(channels.create).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ type: ChannelType.WHATSAPP_OFFICIAL }),
      undefined,
      { skipAutoSubscribe: true },
    );
    expect(channels.ensureWaOfficialSubscription).toHaveBeenCalledWith('newChan');
  });

  it('canal novo + subscribe falha → needs_review', async () => {
    const { svc, prisma } = makeOnboarding({ subscribed: false });

    await svc.connect('org1', dto as any);

    const finalUpdate = prisma.channel.update.mock.calls.at(-1)[0];
    expect(finalUpdate.data.connectionStatus).toBe('needs_review');
  });

  it('reconexão: número já existe → reexecuta subscribe e não cria canal', async () => {
    const existing = { id: 'existChan', config: { phoneNumberId: 'PN1' } };
    const { svc, channels } = makeOnboarding({ existing, subscribed: true });

    await svc.connect('org1', dto as any);

    expect(channels.create).not.toHaveBeenCalled();
    expect(channels.ensureWaOfficialSubscription).toHaveBeenCalledWith('existChan');
  });

  it('reconexão + subscribe falha → needs_review', async () => {
    const existing = { id: 'existChan', config: { phoneNumberId: 'PN1' } };
    const { svc, prisma } = makeOnboarding({ existing, subscribed: false });

    await svc.connect('org1', dto as any);

    const finalUpdate = prisma.channel.update.mock.calls.at(-1)[0];
    expect(finalUpdate.data.connectionStatus).toBe('needs_review');
  });
});
