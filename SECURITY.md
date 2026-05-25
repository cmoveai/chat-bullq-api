# Segurança e LGPD · CMOVE.AI-ZAP (chat-bullq)

> **Framework completo:** `~/.claude/projects/-Users-cris/memory/reference_security_lgpd_framework.md`
> Este documento é o recorte aplicável ao chat-bullq. Atualizar aqui SEMPRE que mudar algo de segurança ou LGPD no repo.

## Status atual (2026-05-05)

### ✅ Tem
- Auth bcrypt + JWT (access + refresh) próprio · módulo `src/modules/auth/`
- **NOVO (Fase 5 SSO):** `SupabaseJwtStrategy` valida JWT do Supabase Auth via `supabase.auth.getUser()` · JIT lookup de User no postgres por email · paralelo ao auth próprio
- **NOVO:** `SupabaseAuthGuard` em `common/guards/supabase-auth.guard.ts` · usar com `@UseGuards(SupabaseAuthGuard)` em endpoints novos
- **NOVO:** endpoint de teste `GET /api/v1/auth/me-supabase` (devolve user + roles + especialista_id do Supabase)
- Multi-tenant em código: `organizations` + `user_organizations` + RBAC OWNER/ADMIN/AGENT
- helmet ativo (`src/main.ts`)
- ValidationPipe global (whitelist + forbidNonWhitelisted)
- CORS configurável por env (`CORS_ORIGIN`)
- WebhookThrottleGuard nos webhooks Meta

### Pendente Fase 6 SSO · cookie compartilhado .cmove.ai
Pra LOGIN único entre `cmove.ai` (LAUNCH) e `zap.cmove.ai` (ZAP):
1. Hospedar ZAP em subdomínio de cmove.ai (hoje localhost · ativa quando subir VPS Hostinger)
2. Em `lib/supabase-browser.ts`, customizar `createBrowserClient` com cookie options `{ domain: '.cmove.ai', sameSite: 'lax' }`
3. Validar que `supabase.auth.getSession()` lê o mesmo cookie em ambos os domínios
4. Logout num invalida o outro automaticamente

Hoje SSO é via JWT compartilhado em memory · cookie compartilhado é otimização de UX.

### ❌ Falta (Onda 1 · BLOQUEIA venda)
- [ ] `@nestjs/throttler` global em `/login` `/register` `/forgot` (ainda aceita brute force)
- [ ] Brute force lockout (5 tentativas → bloqueio 15min · log)
- [ ] Senha policy (min 10 chars · zxcvbn ≥3 · top-1000 vazadas)
- [ ] Email verification obrigatório no signup
- [ ] Reset senha com token único expirável
- [ ] Headers extras (CSP + HSTS + X-Frame-Options) no `helmet()`
- [ ] CORS allowlist explícita (hoje aceita o que vier no env)
- [ ] Fechar Swagger `/docs` atrás de auth ou só em dev
- [ ] Auth check em `/api/v1/uploads/*` (verificar ownership do arquivo)
- [ ] Secrets gestão (.env fora do git · rotação · centralizar)
- [ ] VPS migration + hardening (UFW · SSH key only · fail2ban · auto-update sec)
- [ ] Backup automático criptografado Postgres + verificação semanal
- [ ] Logs de auditoria (login, criar/excluir org, mudança plano, mudança senha)
- [ ] Email "novo login" em IP/device novo
- [ ] Soft delete + retenção 30d antes de wipe
- [ ] Encryption at rest Postgres (validar Hostinger ativa após migration)
- [ ] Tokens 3rd-party criptografados no DB (Meta, Google · não plain text)
- [ ] Webhook signature validation (Meta, Kirvano, Resend)

### ❌ Falta LGPD (Onda 1 · BLOQUEIA venda)
- [ ] Política de Privacidade pública atualizada
- [ ] Termos de Uso com cláusulas SaaS
- [ ] DPA template anexo aos Termos
- [ ] Banner de cookies (se usar tracking)
- [ ] Página `/privacidade/exercer-direitos` com formulário
- [ ] Email DPO + SLA 15d resposta
- [ ] RoPA (Registro de Operações de Tratamento)
- [ ] Endpoint `/api/lgpd/export` (titular pede ZIP JSON)
- [ ] Endpoint `/api/lgpd/delete` (titular pede hard delete)
- [ ] Aviso de coleta no signup
- [ ] Consent log imutável

## Checklist antes de mergear feature nova

- [ ] Quais dados toca? PII? Sensível?
- [ ] RBAC + RLS check
- [ ] Tem rate limit?
- [ ] Logs de auditoria das ações críticas?
- [ ] Validação de input (DTO + ValidationPipe)?
- [ ] Tem teste?

## Cronograma pra abrir Beta

Ver `reference_security_lgpd_framework.md` (5 semanas focadas).

## Resposta a incidente

1. Detectar (logs/alertas)
2. Conter (revogar tokens, isolar)
3. Avaliar impacto (quantos clientes? que dados?)
4. Notificar (clientes + ANPD se LGPD)
5. Postmortem público se grave

## Backup verification

Domingo 3h da manhã · cron restaura backup em DB temporário, roda smoke tests, manda email pra cris@cmove.ai com OK/FAIL.

## Quarterly review

1ª semana de cada trimestre: rodar checklist completo + atualizar RoPA + verificar policies + revisar permissões.
