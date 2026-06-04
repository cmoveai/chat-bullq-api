---
doc: 01-produto-e-modulos
escopo: Módulos da plataforma e estado real de cada um
agentes: todos
atualizado: 2026-06-04
---

# Produto e módulos

Estado real de cada módulo. Use os rótulos: **Pronto** (em produção, validado), **Gated** (existe, depende de aprovação Meta para uso amplo), **Em desenvolvimento** (não disponível ao cliente — não prometer).

## Inbox omnichannel — Pronto
Caixa de entrada única de conversas de WhatsApp e Instagram. Filtro por canal, identificação de origem do contato. A conversa é a unidade central; o canal é um atributo.

## WhatsApp — Pronto (com limites Meta)
Canal de WhatsApp para receber e enviar mensagens. Recebimento e resposta dentro da janela de atendimento funcionam. Envio amplo/proativo e templates dependem de aprovação Meta — ver `07`.

## Instagram Automation — Pronto (modo controlado)
DM e comentário no Instagram. Comentário pode disparar uma DM automática; DM pode disparar fluxo (palavra-chave → resposta, tag, qualificação). Conceito semelhante ao ManyChat, porém integrado ao funil e à IA. Limite atual: enquanto o app está em fase de aprovação, a entrega de mensagem é restrita — ver `08`.

## CRM / Funil — Pronto
Funil de vendas com etapas (stages), oportunidades (cards), atividades (tasks), lead score, status de qualificação e histórico auditável de movimentação. Ver `09`.

## Automações / Flow Builder — Pronto (backend) 
Motor de automações por gatilho/condição/ação. Inclui ações sobre o funil (mover etapa, qualificar, score, criar task, follow-up, handoff). Ver `10`.
- **Em desenvolvimento**: a paleta visual no construtor para as ações de funil ainda está sendo finalizada; hoje essas ações são configuradas pela equipe.

## Agentes de IA / SDR — Pronto (camada segura validada)
Agentes que atendem, qualificam e operam o funil por meio de ferramentas seguras e auditadas. Todo movimento de card, score, task, follow-up e ganho/perda passa por essa camada e é registrado. Ver `09` e `14`.

## Conexão Meta (Tech Provider) — Gated
Conexão oficial com WhatsApp Business e Instagram. Onboarding assistido funciona; o autoatendimento de conexão (Embedded Signup) está montado mas ainda não liberado ao cliente final. Ver `06`.

## CAPI / Pixel / Dataset / Atribuição de anúncios — Em desenvolvimento
Conversões de servidor (CAPI), Pixel, Dataset e atribuição de Meta Ads. **Não disponível ao cliente.** Existe apenas captura de origem do contato. Ver `11`. **Não prometer.**

## O que NÃO prometer ainda

- CAPI, Pixel, Dataset e atribuição de Meta Ads: em desenvolvimento, indisponível.
- Embedded Signup self-serve: montado, não ativado.
- Paleta visual das ações de funil no construtor: em finalização.
- Envio em massa/proativo no WhatsApp e Instagram em escala: depende de aprovação Meta.
- Disparo automático de follow-up por cron sem ação: em desenvolvimento (o follow-up gera task e data; a execução automática ainda é assistida).
