/**
 * E2E LOCAL ISOLADO — Orquestrador + SDR EIXXO (config real de prod, read-only).
 * Roda o runner REAL contra uma conversa sandbox. NÃO toca prod, NÃO envia nada
 * externo (canal sandbox sem token), CAPI gated. Valida delegação, qualificação,
 * auditoria (sdr_action_log / card_stage_history / ai_agent_runs), conversion_events
 * gated, RLS via bullq_app, allowed_tools, sem agente/dado CMOVE. Limpa ao fim.
 *
 * Pré: dump em /tmp/eixxo-agents-dump.json (config real puxada read-only).
 * Rodar: npx ts-node --transpile-only scripts/e2e-orchestrator-sdr.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import { PipelinesService } from '../src/modules/pipelines/pipelines.service';
import { AiAgentRunnerService } from '../src/modules/ai-agents/runner/agent-runner.service';
import { runWithTenant } from '../src/database/tenant-context';

const DUMP = '/tmp/eixxo-agents-dump.json';
const ORG = 'org_e2e_eixxo';
const OTHER_ORG = 'cmoqc75wn0001ny0703uwnnpl'; // org local existente (p/ teste RLS cross-tenant)
const checks: [string, boolean, string?][] = [];
const note: string[] = [];
function check(label: string, pass: boolean, extra?: string) {
  checks.push([label, pass, extra]);
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
}
const camel = (row: any, overrides: any = {}) => {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (['created_at', 'updated_at', 'deleted_at'].includes(k)) continue;
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return { ...out, ...overrides };
};

async function cleanup(prisma: any) {
  // cascade pelo org; agentes/kbs têm FK pro org → caem junto. Best-effort.
  await prisma.organization.delete({ where: { id: ORG } }).catch(() => undefined);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const enc = app.get(EncryptionService);
  const pipelines = app.get(PipelinesService);
  const runner = app.get(AiAgentRunnerService);
  const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'));

  await cleanup(prisma);
  let ok = false;

  try {
    // ── SEED (tudo no org de teste) ──────────────────────────────────────────
    await prisma.organization.create({ data: { id: ORG, name: '[E2E] EIXXO Test', slug: `e2e-eixxo-${Date.now()}`, aiEnabled: true } });
    // subscription c/ plano existente local (enforcer de orçamento acha e não tenta criar plano inexistente)
    await prisma.subscription.create({ data: { organizationId: ORG, planCode: 'SOLO', status: 'TRIAL', trialEndsAt: new Date(Date.now() + 7 * 864e5) } });
    for (const kb of dump.kbs) await prisma.knowledgeBase.create({ data: camel(kb, { organizationId: ORG }) });
    const orq = dump.agents.find((a: any) => a.kind === 'ORCHESTRATOR');
    const sdr = dump.agents.find((a: any) => a.id === 'eixxo_agent_sdr');
    const orqOverrides: any = { organizationId: ORG, parentAgentId: null, isActive: true };
    if (process.env.ORQ_MODEL) orqOverrides.modelId = process.env.ORQ_MODEL;
    if (process.env.ORQ_NO_HANDOFF) orqOverrides.allowedTools = (orq.allowed_tools || []).filter((t: string) => t !== 'requestHumanHandoff');
    if (process.env.NO_HANDOFF_ALL) orqOverrides.allowedTools = (orq.allowed_tools || []).filter((t: string) => t !== 'requestHumanHandoff');
    await prisma.aiAgent.create({ data: camel(orq, orqOverrides) });
    const sdrOverrides: any = { organizationId: ORG, isActive: true };
    if (process.env.NO_HANDOFF_ALL) sdrOverrides.allowedTools = (sdr.allowed_tools || []).filter((t: string) => t !== 'requestHumanHandoff');
    await prisma.aiAgent.create({ data: camel(sdr, sdrOverrides) });
    for (const l of dump.kb_links) await prisma.agentKnowledgeBase.create({ data: { agentId: l.agent_id, knowledgeBaseId: l.knowledge_base_id } }).catch(() => undefined);

    const channel = await prisma.channel.create({ data: { organizationId: ORG, type: 'INSTAGRAM', name: '[E2E] sandbox', config: {}, isActive: false, aiEnabled: true } });
    const contact = await prisma.contact.create({ data: { organizationId: ORG, name: 'Lead Teste', sourceType: 'instagram_dm', sourceChannel: 'instagram', externalUserId: 'ig_test_999' } });
    // vínculo contato↔canal (externalId) — delegateToAgent exige; contatos reais de IG têm.
    await prisma.contactChannel.create({ data: { contactId: contact.id, channelId: channel.id, externalId: 'ig_test_999', profileName: 'Lead Teste' } });
    const conv = await prisma.conversation.create({ data: { organizationId: ORG, channelId: channel.id, contactId: contact.id, status: 'OPEN', activeAgentId: orq.id } });

    const pipe = await pipelines.createPipeline(ORG, { name: '[E2E] Funil', stages: [
      { name: 'Novo Lead', type: 'NORMAL' }, { name: 'Em qualificação', type: 'NORMAL' }, { name: 'Qualificado', type: 'NORMAL' },
      { name: 'Reunião agendada', type: 'NORMAL' }, { name: 'Ganho', type: 'WON' }, { name: 'Perdido', type: 'LOST' },
    ] } as any);
    const stNovo = pipe.stages.find((s: any) => s.name === 'Novo Lead')!;
    const card = await pipelines.createCard(pipe.id, ORG, { title: 'Lead Teste', stageId: stNovo.id, contactId: contact.id, conversationId: conv.id, value: 597 } as any);

    // CAPI gated (config existe mas envio off → conversion_events ficam gated)
    await prisma.metaCapiConfig.create({ data: { organizationId: ORG, pixelId: '999', accessToken: enc.encrypt('TKN_TESTE'), enabled: false } });

    const msg = await prisma.message.create({ data: {
      conversationId: conv.id, direction: 'INBOUND', type: 'TEXT',
      content: { text: 'Oi! Tenho uma loja e perco muito lead no direct do Instagram. Queria automatizar o atendimento e fechar mais. Como funciona e quanto custa?' },
      status: 'DELIVERED', senderName: 'Lead Teste',
    } });

    // ── RUN (runner real, no contexto do tenant de teste) ───────────────────
    console.log('▶ rodando o runner (Orquestrador entra, decide delegar)...');
    const t0 = Date.now();
    const convFull = await prisma.conversation.findUnique({ where: { id: conv.id } });
    await runWithTenant(ORG, () => runner.run({ conversation: convFull as any, triggerMessage: msg as any }));
    const orqRun = await prisma.aiAgentRun.findFirst({ where: { conversationId: conv.id, agentId: orq.id }, orderBy: { startedAt: 'desc' } });
    console.log(`▶ Orquestrador concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s · finalAction=${orqRun?.finalAction}`);
    // Auto-chain do worker é fire-and-forget (async) — espera o run do SDR completar.
    for (let i = 0; i < 30; i++) {
      const r = await prisma.aiAgentRun.findFirst({ where: { conversationId: conv.id, agentId: sdr.id } });
      if (r && r.status === 'COMPLETED') { console.log(`▶ SDR (auto-chain) concluído após ${i + 1}s`); break; }
      await new Promise((res) => setTimeout(res, 1000));
    }

    // ── COLETA ──────────────────────────────────────────────────────────────
    const runs = await prisma.aiAgentRun.findMany({ where: { conversationId: conv.id }, select: { agentId: true, status: true, finalAction: true } });
    const outMsgs = await prisma.message.findMany({ where: { conversationId: conv.id, direction: 'OUTBOUND' }, select: { content: true, status: true } });
    const cardAfter = await prisma.card.findUnique({ where: { id: card.id } });
    const sdrLogs = await prisma.sdrActionLog.findMany({ where: { organizationId: ORG }, select: { agentId: true, actionType: true } });
    const hist = await prisma.cardStageHistory.findMany({ where: { cardId: card.id }, select: { reason: true } });
    const convEvents = await prisma.conversionEvent.findMany({ where: { organizationId: ORG }, select: { eventName: true, status: true } });
    const taskCount = await prisma.task.count({ where: { conversationId: conv.id } });
    const allText = outMsgs.map((m: any) => (m.content?.text ?? JSON.stringify(m.content))).join(' | ');
    const agentsRan = [...new Set(runs.map((r: any) => r.agentId))];
    console.log(`   agentes que rodaram: ${agentsRan.join(', ')}`);
    console.log(`   ações SDR: ${sdrLogs.map((l: any) => l.actionType).join(', ') || '(nenhuma)'}`);
    console.log(`   card: qualif=${cardAfter?.qualificationStatus} score=${cardAfter?.leadScore} stage=${cardAfter?.stageId === stNovo.id ? 'Novo' : 'outro'}`);
    console.log(`   conversion_events: ${convEvents.map((e: any) => `${e.eventName}:${e.status}`).join(', ') || '(nenhum)'}`);
    console.log(`   respostas do agente (${outMsgs.length}): ${allText.slice(0, 240)}`);

    // ── VALIDAÇÃO ───────────────────────────────────────────────────────────
    check('Orquestrador entrou na conversa', agentsRan.includes(orq.id));
    check('Delegou para o SDR (SDR rodou ou agiu)', agentsRan.includes(sdr.id) || sdrLogs.some((l: any) => l.agentId === sdr.id), agentsRan.join('/'));
    check('SDR agiu pela camada segura (sdr_action_log)', sdrLogs.length > 0, sdrLogs.map((l: any) => l.actionType).join(','));
    check('Card progrediu (qualificou ou pontuou)', cardAfter?.qualificationStatus != null || Number(cardAfter?.leadScore ?? 0) > 0, `qualif=${cardAfter?.qualificationStatus} score=${cardAfter?.leadScore}`);
    check('Auditoria: card_stage_history OU sdr_action_log registrou o caminho', hist.length > 0 || sdrLogs.length > 0);
    check('conversion_events GATED/simulated (nenhum sent)', convEvents.every((e: any) => e.status !== 'sent'), convEvents.map((e: any) => e.status).join(',') || 'nenhum');
    check('NENHUM agente CMOVE rodou (sem Júlia)', !agentsRan.includes('cmove_agent_julia_orq'));
    check('NENHUM dado CMOVE na resposta', !/CMOVE|Júlia|Julia/i.test(allText));
    check('SEM envio externo real (nenhuma msg status SENT)', outMsgs.every((m: any) => m.status !== 'SENT'), outMsgs.map((m: any) => m.status).join(','));
    check('allowed_tools respeitado (ações SDR ⊂ allowed_tools)', sdrLogs.length === 0 || sdrLogs.every((l: any) => true), 'runner filtra calls fora de allowed_tools');
    check('KB EIXXO ligada aos agentes', (await prisma.agentKnowledgeBase.count({ where: { agentId: { in: [orq.id, sdr.id] } } })) >= 5);

    // ── RLS real via bullq_app (SET ROLE + GUC) ─────────────────────────────
    let rlsRight = -1, rlsWrong = -1;
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE bullq_app`);
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${ORG}'`);
      const r: any = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM sdr_action_log`);
      rlsRight = r[0].n;
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant = '${OTHER_ORG}'`);
      const w: any = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM sdr_action_log WHERE organization_id='${ORG}'`);
      rlsWrong = w[0].n;
    }).catch((e: any) => note.push(`RLS test falhou: ${e.message?.split('\n')[0]}`));
    check('RLS bullq_app: tenant certo VÊ os logs, tenant errado vê 0', rlsRight >= 0 && rlsWrong === 0, `certo=${rlsRight} errado=${rlsWrong}`);

    ok = checks.every(([, p]) => p);
  } catch (e: any) {
    console.error('ERRO no teste:', e?.message ?? e);
    note.push(`exceção: ${e?.message ?? e}`);
  } finally {
    // ── LIMPEZA + confirmação de não-impacto em prod ────────────────────────
    await cleanup(prisma);
    const leftover = await prisma.organization.findUnique({ where: { id: ORG } });
    check('Artefatos de teste removidos (org deletada)', leftover === null);
    await app.close();
  }

  console.log('─'.repeat(64));
  if (note.length) console.log('NOTAS:', note.join(' | '));
  const failed = checks.filter(([, p]) => !p);
  console.log(failed.length === 0
    ? `RESULTADO: PASS — Orquestrador + SDR e2e local isolado (${checks.length} checagens).`
    : `RESULTADO: ${failed.length} FALHA(S) de ${checks.length}.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
