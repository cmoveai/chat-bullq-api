import { SubscriptionStatus } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Regra de acesso trial-first: ACTIVE e TRIAL válido liberam; TRIAL expirado
 * e PAST_DUE/CANCELED/EXPIRED/sem assinatura bloqueiam.
 */
function makeService(sub: any) {
  const prisma = { subscription: { findUnique: jest.fn().mockResolvedValue(sub) } };
  return new (SubscriptionsService as any)(prisma);
}

const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const past = () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

describe('SubscriptionsService.getAccountStatus (acesso trial-first)', () => {
  it('ACTIVE libera acesso', async () => {
    const svc = makeService({ status: SubscriptionStatus.ACTIVE, trialEndsAt: null, planCode: 'GROWTH' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(false);
    expect(r.status).toBe('ACTIVE');
  });

  it('TRIAL com trial_ends_at futuro libera acesso', async () => {
    const svc = makeService({ status: SubscriptionStatus.TRIAL, trialEndsAt: future(), planCode: 'STARTER' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(false);
    expect(r.reason).toBe('trial_active');
  });

  it('TRIAL com trial_ends_at passado bloqueia', async () => {
    const svc = makeService({ status: SubscriptionStatus.TRIAL, trialEndsAt: past(), planCode: 'STARTER' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('trial_expired');
  });

  it('TRIAL sem trial_ends_at bloqueia', async () => {
    const svc = makeService({ status: SubscriptionStatus.TRIAL, trialEndsAt: null, planCode: 'STARTER' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('trial_expired');
  });

  it('PAST_DUE bloqueia', async () => {
    const svc = makeService({ status: SubscriptionStatus.PAST_DUE, trialEndsAt: null, planCode: 'GROWTH' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('past_due');
  });

  it('CANCELED bloqueia', async () => {
    const svc = makeService({ status: SubscriptionStatus.CANCELED, trialEndsAt: null, planCode: 'GROWTH' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('canceled');
  });

  it('EXPIRED bloqueia', async () => {
    const svc = makeService({ status: SubscriptionStatus.EXPIRED, trialEndsAt: null, planCode: 'GROWTH' });
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('expired');
  });

  it('sem assinatura bloqueia', async () => {
    const svc = makeService(null);
    const r = await svc.getAccountStatus('org');
    expect(r.suspended).toBe(true);
    expect(r.reason).toBe('no_subscription');
  });

  it('EIXXO Hub (ACTIVE/GROWTH) continua liberada', async () => {
    const svc = makeService({ status: SubscriptionStatus.ACTIVE, trialEndsAt: null, planCode: 'GROWTH' });
    const r = await svc.getAccountStatus('cmqfk1s3h0002pd06jhu9wb0p');
    expect(r.suspended).toBe(false);
    expect(r.planCode).toBe('GROWTH');
  });
});
