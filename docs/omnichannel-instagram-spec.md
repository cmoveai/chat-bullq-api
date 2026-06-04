# Spec Oficial — Módulo Omnichannel (Instagram Automation estilo ManyChat)

**Decisão arquitetural (Cris, 04/06/2026):** omnichannel **genérico**. Instagram é apenas
`channel.type`, como WhatsApp/Webchat. **Proibido criar família `Instagram*`** (InstagramConversation,
InstagramMessage, InstagramAutomationRule...). Tudo isolado por `organization_id` (tenant) com RLS.

Fluxo canônico: `channels → conversations → messages → contacts(lead) → automation_rules → chatbot_flows`.

---

## 1. Modelo de dados

### 1.1 JÁ EXISTE (reaproveitar, genérico) — provado no banco 04/06
- **channels** — `type` (WHATSAPP_OFFICIAL/WHATSAPP_ZAPI/WHATSAPP_ZAPPFY/INSTAGRAM), `config` jsonb (igBusinessId, igUserId, pageId, accessToken **cifrado enc:v1**, appSecret), is_active, visibility, org_id, RLS.
- **conversations** — channel_id, contact_id, **assigned_to_id** (user), **active_agent_id** (ai_agent), status, last_message_at, org_id, RLS.
- **messages** — direction (MessageDirection), type (MessageContentType), content jsonb, **external_id** (idempotência, UNIQUE channel+external_id), metadata jsonb, RLS.
- **contacts** (= lead) — name, phone, email, avatar_url, notes, **metadata jsonb**, org_id, RLS.
- **automations** — JÁ genérico: org_id, **channel_id**, name, type, is_active, **config jsonb**, executions_count. → é o "automation_rules".
- **chatbot_flows** + **chatbot_nodes** — motor de fluxo; node types atuais: START, MESSAGE, MENU, CONDITION, ACTION, WAIT, TRANSFER, END_FLOW. (0 fluxos criados).
- **webhook_events** — raw_payload + headers + status (= "webhook_logs").
- **ai_agent_handoffs** — handoff humano. **inbox_views** — inbox.

### 1.2 ADICIONAR
**A. contacts — campos de atribuição** (ALTER TABLE):
`source_type`, `source_channel`, `external_user_id`, `campaign_id`, `campaign_name`, `ad_id`, `ad_name`,
`adset_id`, `adset_name`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`,
`fbclid`, `fbp`, `fbc`, `first_message`, `first_interaction_type`, `referral_source`.
(ids sociais opcionais — instagram_user_id/whatsapp_id — ficam em `metadata` jsonb, não colunas.)
Índices: source_type, campaign_id, ad_id.

**B. messages — `source`** (enum MessageSource): INSTAGRAM_DM, INSTAGRAM_COMMENT, INSTAGRAM_STORY_REPLY,
INSTAGRAM_MENTION, WHATSAPP, WEBCHAT, AD_CTWA, AD_CTIG. (default por channel.type).

**C. social_interactions** (NOVA, genérica — substitui InstagramComment/Mention):
id, org_id, channel_id, contact_id (nullable), conversation_id (nullable), `interaction_type`
(COMMENT/MENTION/STORY_REPLY/REACTION), `external_interaction_id` (idempotência, UNIQUE channel+ext),
media_id, parent_id, text, matched_keyword, automation_rule_id (nullable), raw_payload jsonb, created_at.
RLS tenant_isolation.

**D. automation_rules** — usar `automations` + estender config/colunas: `trigger_type` (enum:
DM_RECEIVED, COMMENT_RECEIVED, COMMENT_KEYWORD, COMMENT_ON_POST, STORY_REPLY, MENTION, AD_CLICK,
LEAD_IDLE, HUMAN_REQUESTED), `keywords` text[], `keyword_match_type`, `media_scope`, `flow_id`,
`ai_agent_id`. (decisão: colunas vs tudo em config — recomendo colunas pros indexáveis: trigger_type,
keywords, channel_id; resto em config.)

**E. chatbot_nodes — node types adicionais** (ALTER enum, cuidado P3009): além de ACTION genérico,
subtipos via config OU novos valores: ADD_TAG, UPDATE_CRM_STAGE, ASSIGN_USER, ASSIGN_AI_AGENT,
SEND_CAPI_EVENT, CREATE_TASK, ASK_QUESTION. (Recomendo: manter ACTION e detalhar `action_type` no
config do node — evita migration de enum frágil.)

**F. Camada de atribuição/CAPI** (NOVA, genérica multi-canal):
- **meta_pixel_configs** — org_id, pixel_id, dataset_id, capi_token (cifrado), is_active. RLS.
- **conversion_events** — org_id, contact_id, event_type (Lead/Contact/Purchase/...), source_channel,
  event_payload jsonb, capi_status (PENDING/SENT/FAILED), event_id (dedup), created_at. RLS.

---

## 2. Migrations (ordem)
1. `ALTER TABLE contacts` ADD colunas de atribuição + índices.
2. `CREATE TYPE MessageSource` + `ALTER TABLE messages ADD source`.
3. `CREATE TABLE social_interactions` + RLS `tenant_isolation` + UNIQUE(channel_id, external_interaction_id).
4. `ALTER TABLE automations` ADD trigger_type/keywords/keyword_match_type/media_scope/flow_id/ai_agent_id.
5. `CREATE TABLE meta_pixel_configs` + `conversion_events` + RLS.
6. (opcional) enum node types — **se** for por enum: aplicar ALTER manual em prod + `migrate resolve`
   ANTES do deploy (lição P3009 de hoje). **Preferir** action_type em config (sem migration de enum).
Toda tabela nova: `organization_id` + `ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY` + policy.

---

## 3. Endpoints

### Permanecem (não fragmentar)
- **`POST/GET /api/v1/webhooks/INSTAGRAM`** — unificado: valida assinatura (re-assinada pela netlify),
  idempotência por external_id/external_interaction_id, roteia por igBusinessId→channel→tenant,
  processa DM + comments + mentions + story. Mantém um endpoint, não fragmenta em /messages /comments /mentions.
- channels, conversations, messages, contacts, automations, chatbot_flows, inbox_views CRUD.

### Novos
- `GET/POST/PATCH/DELETE /automation-rules` (ou estende /automations) — regras por canal.
- `GET /social-interactions` — comments/mentions/story por canal/contato.
- `flow-builder`: `/chatbot-flows/:id/nodes`, `/edges` (estende o motor).
- `/meta/pixel-config` (CRUD config por tenant) + `/conversion-events` (registrar/reenviar CAPI).
- inbox social: estende `inbox-views` com filtros multicanal + origem do lead.

---

## 4. Plano de implementação por fases

**Fase 0 — gate externo (paralelo, não bloqueia):** App Review Meta aprovar → libera OUTBOUND IG.

**Fase 1 — Atribuição + persistência social + inbox** (NÃO depende da Meta):
contacts attribution fields · messages.source · social_interactions + persistir comments/mentions no
webhook · inbox social com origem/canal. Aceite: lead do IG nasce com source_type/origem; comments gravam.

**Fase 2 — Engine de automation rules** (NÃO depende da Meta p/ a lógica; resposta sai na Fase 5):
trigger types (DM/comment/keyword) + processador · keyword matching + comment→DM (migrar do netlify
legado pro ZAP sem quebrar o cmove.ai) · ações: criar lead, add tag, mover pipeline, atribuir agente.

**Fase 3 — Flow Builder:** action_type nos nodes (add_tag/assign/capi/task) · UI builder · fluxos multicanal.

**Fase 4 — Atribuição + CAPI (genérica multi-canal):** meta_pixel_configs + conversion_events ·
referral de anúncio (CTWA/CTIG) no webhook · envio CAPI (Lead/Contact) por tenant.

**Fase 5 — Outbound IG (pós-App Review):** DM/resposta privada/botões em prod → liga fluxos 1+2 ponta a ponta.

---

## 5. Riscos técnicos
- **Outbound IG** depende de App Review (externo, sem controle nosso). Constrói a lógica antes; "liga" depois.
- **Migration de ENUM** (source/node types) → P3009 (visto hoje): aplicar ALTER manual + `migrate resolve`
  antes do deploy, OU evitar enum (usar config/text).
- **Idempotência**: external_id (messages) + external_interaction_id (social) UNIQUE por canal — evita dup.
- **RLS**: toda tabela nova com org_id + tenant_isolation (social_interactions, conversion_events, pixel_configs).
- **CAPI**: dedup por event_id, rate limit, LGPD (hash de PII: email/phone).
- **Netlify legado** (comments/keywords do cmove.ai) vs ZAP — migrar sem derrubar automações de comentário atuais.
- **Não misturar tenant**: roteamento igBusinessId→channel→org já provado; manter como invariante.

---

## 6. Critérios de aceite (os 10 da Cris → estado/fase)
1. Conectar IG próprio — ✅ hoje (script onboard-ig) / Fase 1 self-serve.
2. Automação comentário→DM — Fase 2.
3. Automação por palavra-chave — Fase 2.
4. Fluxos estilo ManyChat — Fase 3.
5. Atender DMs em inbox — ✅ recebe / Fase 1 inbox social.
6. Agente de IA no IG — Fase 2 (lógica) + Fase 5 (responder).
7. Transferir para humano — ✅ (ai_agent_handoffs).
8. Criar lead do IG — ✅ recebe+cria / Fase 1 atribuição.
9. Conversões por Pixel/CAPI próprio — Fase 4.
10. Tudo isolado por tenant_id — ✅ RLS (49 tabelas) + toda nova com RLS.

---

## 6.5 Funil de Vendas / SDR (decisão 04/06 — genérico, omnichannel, por tenant)

**Decisão:** o funil NÃO pertence a canal nenhum. Lead de WhatsApp/IG/Landing/Ads cai no
**mesmo CRM/funil do tenant**. Reaproveitar o genérico — **NÃO criar `deals`/`opportunities`/
`sdr_agent_logs`/`lead_scores`/`lead_assignments` como tabelas novas.**

### Já existe (provado no banco 04/06)
- **deal/opportunity = `cards`** (org_id, pipeline_id, stage_id, title, value, currency, status, order, contact_id, conversation_id, assigned_to_id, closed_reason, closed_at).
- **`pipelines` + `pipeline_stages`** (stage: name/color/type/order). Suporta N funis por org (a confirmar uso).
- **`tasks`** (= tasks/activities).
- **SDR agent = `ai_agents`** com `lead_qualification_enabled/prompt/trigger/message_count`.
- **sdr_agent_logs = `ai_agent_runs`** (agent_id, conversation_id, final_action, status, tokens, cost, duration).
- **`automations`** = motor de regras (estender triggers).

### VALIDAÇÃO OFICIAL (04/06): cards = deals/opportunities — CONFIRMADO
`cards` provado como oportunidade comercial completa: FK contact (lead), pipeline, stage; value
numeric(14,2); currency; status **CardStatus=OPEN/WON/LOST**; assigned_to_id (vendedor); closed_at +
**closed_reason (=lost_reason)**; conversation_id (atendimento); metadata; RLS tenant_isolation. `tasks`
já tem `card_id`+due_date+assigned (=activities). `pipelines` tem org_id+`is_default` (N funis/tenant).
**DECISÃO: NÃO criar deals/opportunities — estender cards.** won_at/lost_at NÃO precisam (status+closed_at).
**Único gap:** histórico de movimentação (cards guarda só stage atual) → criar `card_stage_history` leve
(card_id, from_stage_id, to_stage_id, moved_by, moved_at). SDR opera SOBRE cards (cria/atualiza/move/score).

### Adicionar
**Campos de qualificação SDR** (em `contacts` = lead; alguns no `cards` = deal):
`qualification_status`, `lead_score`, `buying_intent`, `budget_range`, `company_size`, `segment`,
`urgency`, `pain_point`, `objective`, `preferred_channel`, `assigned_ai_agent_id`,
`next_follow_up_at`, `last_contact_at`, `conversion_status`.
(`lost_reason` já = `cards.closed_reason`; `assigned_user_id` já = `cards.assigned_to_id`.)
Decisão coluna vs jsonb: principais consultáveis (qualification_status, lead_score, conversion_status,
next_follow_up_at) = colunas + índices; qualificação livre (pain_point, objective) = colunas TEXT.

**Triggers de funil no motor de automations** (enum trigger_type +=): LEAD_ENTERED, STAGE_CHANGED,
LEAD_IDLE, LEAD_QUALIFIED, LEAD_LOST, MEETING_SCHEDULED, PROPOSAL_SENT, HUMAN_TOOK_OVER.
**Ações** (já cobertas por chatbot_nodes action_type + automations): mover etapa (update_crm_stage),
atribuir vendedor (assign_user), atribuir SDR (assign_ai_agent), criar tarefa (create_task),
enviar msg, iniciar fluxo, CAPI (send_capi_event), tag (add_tag), update lead_score, handoff.

**Pipeline padrão SDR** (seed p/ novos tenants): Novo lead · Primeiro contato · Em qualificação ·
Qualificado · Não qualificado · Aguardando resposta · Reunião agendada · Proposta enviada ·
Em negociação · Ganho · Perdido. (stage.type marca won/lost/open.)

### Capacidades do SDR agent (ai_agent estendido) — aceite
Ler contato+histórico+origem · qualificar (perguntas de diagnóstico via prompt) · atualizar campos do
lead · criar/atualizar card (deal) · mover etapa · aplicar lead_score · criar task p/ vendedor humano ·
agendar reunião (integração futura) · handoff humano · marcar motivo perda (closed_reason) · disparar
conversão (CAPI) quando qualificado. Tudo isolado por tenant_id, métricas comerciais por tenant.

### Fase no roadmap
**Funil/SDR entra na Fase 2.5** (entre automations e flow builder): campos SDR + triggers de funil +
seed do pipeline padrão + ligar lead_qualification do ai_agent ao movimento de card/stage.
Não depende da Meta (qualificação roda em WhatsApp já; em IG responde na Fase 5).

## 7. Ordem correta de implementação
**1 → 2 → 3 → 4 → (5 quando Meta liberar).**
Priorizar **Fase 1+2** (independem da Meta, destravam comment→DM, keyword e atribuição = valor de venda).
Fase 5 (outbound) é o gate da Meta mas é o que faz tudo "responder" — construir a lógica antes pra
"ligar a chave" no dia da aprovação.
