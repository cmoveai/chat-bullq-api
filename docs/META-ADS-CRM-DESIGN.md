# Meta Ads → CRM → CAPI + Painel de Métricas (Fase 2/3)

Design da frente "campanha → lead no CRM → conversão de volta pra Meta → painel".
Multi-tenant: cada tenant (`Organization`) com seu próprio pixel/dataset/ad account,
conexões e métricas. Construir DEPOIS de RLS/webhook estabilizados.

## 0. Conceito-chave (não confundir)

São **dois caminhos**, e o pixel só faz o segundo:

1. **ENTRADA (lead cai no CRM)** = captura de ORIGEM no ponto de entrada. NÃO é o
   pixel que faz. O lead já entra atribuído porque a origem vem no próprio evento:
   - Click-to-WhatsApp → bloco `referral` no webhook de inbound (já temos o webhook).
   - Lead Ads (formulário) → webhook `leadgen`.
   - Landing page → UTM + fbclid na querystring.
2. **SAÍDA (otimização)** = o tenant configura o Pixel/Dataset uma vez; quando rola
   um gatilho no CRM (lead novo / conversa qualificada pela IA / card → Ganho), a
   plataforma dispara `ConversionEvent` server-side (CAPI) pro pixel DAQUELE tenant.

O painel cruza os dois (atribuição dos cards + estágios do funil + status dos eventos).

## 1. Modelo de dados

### Novas entidades (todas com `organizationId` → RLS)
- **MetaAdAccount**: `id, organizationId, adAccountId, name, accessTokenEncrypted, status, createdAt, updatedAt`
- **MetaPixel**: `id, organizationId, pixelId, datasetId, accessTokenEncrypted, domain?, status, createdAt, updatedAt`
- **ConversionEvent**: `id, organizationId, contactId?, cardId?, eventName (Lead|Contact|QualifiedLead|Purchase|CompleteRegistration), eventId (dedup), eventTime, actionSource (chat|website|system_generated), eventSourceUrl?, pixelId, datasetId, payload(Json), status (PENDING|SENT|FAILED|SKIPPED), response(Json?), attempts, createdAt`
- **CampaignSource** (opcional/cache de nomes): `id, organizationId, sourceType, campaignId, campaignName, adsetId, adsetName, adId, adName, lastSeenAt` — ou embutir só os ids/nomes nos campos abaixo.

### Campos de atribuição a ADICIONAR no `Contact` (e espelhar no `Card`)
`source` (whatsapp_ctwa | lead_ad | landing | manual), `sourceType`,
`campaignId, campaignName, adsetId, adsetName, adId, adName`,
`utmSource, utmMedium, utmCampaign, utmContent, utmTerm`,
`fbclid, fbp, fbc, ctwaClid`, `firstMessage`.
(Tokens/secret cifrados via EncryptionService, como já fazemos com WhatsApp.)

## 2. Telas (UX por tenant)

### "Integrações > Meta Ads"
- Botão **Conectar Meta Ads** (Embedded Signup / FB Login pedindo `ads_management`,
  `ads_read`; reusa a máquina do WhatsApp ES) → lista Ad Accounts + Pixels do tenant
  → tenant escolhe → salva `MetaAdAccount` + `MetaPixel` (token cifrado).
- Fallback manual: campos Pixel ID + Dataset ID + token CAPI (colar).
- Toggle por gatilho: quais eventos do CRM disparam CAPI (lead novo / IA qualificou /
  Ganho / pagamento) + mapeamento gatilho→eventName.
- Status: pixel ativo? último evento enviado? erros recentes?

### Pipeline/Funil (já existe — `Pipeline`/`PipelineStage`/`Card`)
- No card, mostrar origem/campanha (badge "veio do anúncio X").
- Mudança de estágio (ex: → Ganho) é o gatilho de conversão.

### "Métricas / Tráfego" (painel novo)
Ver seção 5.

## 3. Fluxos

### Click-to-WhatsApp (principal)
Webhook inbound (já roteado por phone_number_id) → adapter lê `messages[].referral`
(`source_id`=ad_id, `source_url`, `ctwa_clid`, `headline`...) → cria/atualiza Contact
com atribuição + cria Card no pipeline default (estágio 1) → dispara automação →
roteia pro AiAgent → enfileira ConversionEvent `Lead`/`Contact` na CAPI do tenant.

### Lead Ads (formulário)
Webhook `leadgen` (novo endpoint) → resolve tenant (page/form → org) → busca o lead na
Graph API com token do tenant → cria Contact+Card → ConversionEvent `Lead`.

### Landing page (quando o EIXXO servir páginas)
Captura UTM/fbclid, gera fbp/fbc + `event_id` único → cria Contact+Card → dispara `Lead`
no Pixel (client) e na CAPI (server) com o MESMO `event_id` (dedup).

### CRM → CAPI (saída, o loop)
Gatilho (lead criado / estágio WON / IA qualificou) → monta payload com user_data
(ph/email com **SHA-256**, fbp/fbc/fbclid, IP, UA quando disponíveis) → fila BullMQ
`conversion-events` (retry + backoff) → POST `/{pixel|dataset}/events` com `event_id`
pra dedup → grava status/response no `ConversionEvent`.

## 4. Endpoints (API)
- `GET/POST /integrations/meta-ads` (conectar/listar/salvar MetaAdAccount+MetaPixel).
- `GET /integrations/meta-ads/pixels` (lista pixels do ad account conectado).
- `POST /webhooks/meta/leadgen` (público; verify + signature + idempotência por leadgen_id).
- `GET /metrics/ads/overview|by-campaign|funnel|conversions` (painel, org-scoped).
- `GET /conversion-events?status=` (status dos eventos enviados).
- (interno) worker `conversion-events` consumindo a fila.

## 5. Painel de métricas (fontes de dado)
- **Leads por campanha/adset/anúncio** ← `Contact`/`Card` (campos de atribuição), GROUP BY.
- **Leads por origem** (CTWA / form / landing) ← `Contact.source`.
- **Funil** (leads → qualificados → ganhos) ← contagem por `PipelineStage` (+ status WON/LOST).
- **Conversões enviadas pra Meta** ← `ConversionEvent` (status/erro/dedup).
- **CPL / ROAS** ← gasto via Marketing API (`ads_read`, `insights` por campanha) cruzado
  com leads/ganhos do CRM. (2ª onda; exige conexão de ad account.)
- **Taxa de conversão por campanha** = ganhos/leads por campaignId.

## 6. Segurança / qualidade
- Pixel/Dataset/token cifrados (EncryptionService). RLS já cobre as tabelas tenant.
- CAPI: hash SHA-256 dos PII exigidos; `event_id` único por evento p/ dedup pixel↔CAPI.
- Fila com retry/backoff; nunca bloquear o request do CRM no envio do evento.
- Não usar pixel global — sempre o pixel do tenant resolvido pela org.

## 7. Fases
- **F2**: tela Integrações Meta Ads + `MetaAdAccount`/`MetaPixel` + campos de atribuição
  no Contact/Card + captura de `referral` no inbound CTWA (liga lead↔campanha).
- **F3**: `ConversionEvent` + fila CAPI + gatilhos (lead/IA-qualificou/WON) + painel base.
- **F4**: leadgen + landing/pixel client + CPL/ROAS via Marketing API.
- TikTok/Google: mesma estrutura (`ConversionEvent` agnóstico), Events API / Google Ads API.
