---
doc: 06-onboarding-meta
escopo: Conexão com a Meta — WABA, IG Business, Embedded Signup, verificação
agentes: Onboarding Meta, Especialista de Produto (parcial)
atualizado: 2026-06-04
---

# Onboarding Meta

Orienta o cliente a conectar suas contas oficiais da Meta ao EIXXO. O EIXXO opera no modelo **Tech Provider**, usando APIs oficiais — sem intermediários não-oficiais.

## Conceitos que o cliente precisa entender

- **WABA (WhatsApp Business Account)**: a conta de WhatsApp Business na Meta que hospeda o número e os templates.
- **Instagram Business/Profissional**: o perfil do Instagram precisa ser Profissional/Empresarial para usar mensagens e automação.
- **Business Manager / Portfólio**: onde as contas (página, WABA, IG) ficam organizadas.
- **Embedded Signup**: fluxo guiado de conexão da conta do cliente (autoatendimento).
- **Permissões / Advanced Access**: níveis de acesso que a Meta concede ao app para operar em nome de contas de terceiros.
- **Business Verification**: verificação da empresa junto à Meta, necessária para liberar capacidades.

## Estado atual (ser transparente)

- **Onboarding assistido**: funciona — a conexão do canal do cliente é feita de forma guiada/operada.
- **Embedded Signup (self-serve)**: montado, **ainda não liberado** ao cliente final.
- **Advanced Access / envio amplo**: depende de **aprovação da Meta (App Review)**, em análise.
- **Business Verification**: em andamento.

## Checklist de conexão (assistido)

1. Confirmar perfil Instagram em modo Profissional/Empresarial.
2. Confirmar WhatsApp Business e número disponível.
3. Organizar contas no Business Manager.
4. Conceder as permissões solicitadas.
5. Validar recebimento de mensagens (webhook ativo).

## Quando escalar para humano

- Conta bloqueada/restrita na Meta.
- Erro de verificação ou de permissão que não se resolve no checklist.
- Qualquer falha técnica na conexão → cria task e handoff humano; não prometer prazo de correção.

## O que NÃO prometer ainda

- Liberação imediata de envio amplo (depende de App Review).
- Embedded Signup self-serve disponível ao cliente (não liberado).
- CAPI/Pixel/Dataset (ver `11`, em desenvolvimento).
