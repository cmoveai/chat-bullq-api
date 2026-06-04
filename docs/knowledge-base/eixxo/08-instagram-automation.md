---
doc: 08-instagram-automation
escopo: Instagram — DM, comentário→DM, gatilhos, paralelo ManyChat
agentes: Especialista de Produto, Onboarding Meta, Suporte Técnico
atualizado: 2026-06-04
---

# Instagram Automation

Automação de Instagram do EIXXO: receber e responder DMs, e reagir a comentários — integrado ao funil e à IA. Conceito próximo ao ManyChat, com a diferença de operar sobre o mesmo CRM e os mesmos agentes.

## Capacidades (estado real)

- **DM de entrada**: a DM vira conversa na caixa única e pode virar card.
- **DM dispara automação**: gatilho por DM (palavra-chave → resposta, tag, qualificação, ações de funil).
- **Comentário dispara DM**: quando alguém comenta um post, a plataforma pode enviar uma DM automática (resposta privada ao comentário) e seguir um fluxo.
- **IA respondendo DM**: um agente pode atender a DM, integrado às ferramentas seguras.

## Gatilhos e ações disponíveis

- Gatilhos: **DM nova**, **comentário em post**, mensagem de WhatsApp.
- Condições: **palavra-chave**, **primeira interação**.
- Ações: enviar DM, enviar WhatsApp, marcar tag, e ações de funil (mover etapa, qualificar, score, criar task, follow-up, handoff).

## Limites e dependências (ser transparente)

- Enquanto o app está em **fase de aprovação da Meta**, a entrega de mensagem de Instagram é **restrita** (em ambiente de desenvolvimento, só perfis com papel no app recebem). O uso amplo com qualquer pessoa depende de aprovação.
- Stories e tipos de evento além de DM/comentário podem não estar cobertos — confirmar antes de prometer.

## Diferença para o ManyChat (posicionar sem atacar)

O ManyChat foca na automação de mensagem. No EIXXO, a mesma automação alimenta o funil/CRM e pode ser conduzida por um agente de IA, com histórico e isolamento por cliente. Não posicionar como "melhor", e sim como "integrado".

## O que NÃO prometer ainda

- Entrega de DM para qualquer pessoa em escala antes da aprovação Meta.
- Automação de Stories como recurso garantido (confirmar cobertura).
- Métricas de anúncio/atribuição (ver `11`, em desenvolvimento).
