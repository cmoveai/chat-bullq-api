# WhatsApp Embedded Signup (Tech Provider) — cola pronta

Implementação do onboarding self-serve de WhatsApp para clientes (cada cliente
conecta a WABA dele). Multi-tenant: a organização é o tenant; a tríade
`organizationId · waba_id · phone_number_id` fica no `Channel.config`.

## O que JÁ existia (reaproveitado)

- `Channel` (model Prisma) com `organizationId` + `config` JSON
  (`accessToken`, `phoneNumberId`, `businessAccountId`, `appSecret`, `apiVersion`).
- Roteamento inbound por `phone_number_id` (`whatsapp-official.inbound-adapter` →
  `extractLocators` / `matchesChannel`).
- `WhatsAppOfficialHttpClient.subscribeApp()` → `POST /{waba}/subscribed_apps`.
- `ChannelsService.create()` já assina o app na WABA automaticamente quando
  recebe `businessAccountId`.

## O que foi adicionado (a cola)

**Backend** (`chat-bullq-api`):
- `modules/channel-hub/whatsapp-onboarding/`
  - `dto/embedded-signup.dto.ts` — `{ code, wabaId, phoneNumberId, channelName? }`.
  - `whatsapp-onboarding.service.ts` — troca `code`→token (`/oauth/access_token`),
    registra o número (best-effort), monta o `config` e chama `ChannelsService.create`
    (que assina o app na WABA). Idempotente por (org, phoneNumberId).
  - `whatsapp-onboarding.controller.ts` — `POST /channels/whatsapp/embedded-signup`
    (guards: Jwt + Org + Roles OWNER/ADMIN).
  - Registrado em `channel-hub.module.ts`.

**Frontend** (`chat-bullq-web`):
- `features/channels/lib/embedded-signup.ts` — carrega o FB SDK, roda
  `FB.login` com `config_id` (`response_type=code`) e captura `waba_id` +
  `phone_number_id` do evento `WA_EMBEDDED_SIGNUP`.
- `features/channels/components/connect-whatsapp-button.tsx` — CTA "Conectar
  WhatsApp (automático)". Sem `config_id` setado, mostra aviso e cai no manual.
- `features/channels/services/channels.service.ts` — `embeddedSignup()`.
- Botão montado no topo do form WHATSAPP_OFFICIAL do `create-channel-dialog.tsx`
  (form manual permanece como fallback).

## Para ativar (depois que a Business Verification aprovar)

1. **Aceitar os Termos de Tech Provider / Solution Partner** no app Meta
   (app 1499094515106220).
2. **Advanced Access** para `whatsapp_business_management` (App Review).
3. **Criar a config do Embedded Signup** no painel → copiar o `config_id`.
4. Preencher as env e fazer deploy:
   - `chat-bullq-api`: `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`,
     (opcional) `META_PHONE_REGISTER_PIN`.
   - `chat-bullq-web`: `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`,
     `NEXT_PUBLIC_META_GRAPH_VERSION`.
5. Testar o fluxo: dashboard → Configurações → Canais → Novo → WhatsApp Official
   → "Conectar WhatsApp (automático)".

Enquanto as env estiverem vazias, nada quebra: o botão exibe o aviso e o
cadastro manual segue funcionando.
