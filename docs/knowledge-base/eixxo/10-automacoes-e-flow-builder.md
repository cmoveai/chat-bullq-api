---
doc: 10-automacoes-e-flow-builder
escopo: Automações/BPMN — gatilhos, condições, ações, estado do construtor
agentes: Especialista de Produto, Suporte Técnico, Customer Success
atualizado: 2026-06-04
---

# Automações e Flow Builder

O motor de automações executa fluxos por **gatilho → condição → ação**, configuráveis sem código. Cada fluxo é opt-in (só roda se ativo) e isolado por cliente.

## Gatilhos (triggers)

- **DM do Instagram** (mensagem direta nova).
- **Comentário no Instagram** (em post).
- **Mensagem de WhatsApp** (nova mensagem do cliente).

## Condições

- **Palavra-chave** (texto contém termo(s); modo "qualquer" ou "todas").
- **Primeira interação** (é o primeiro contato).

## Ações

- **Enviar DM** (Instagram), **Enviar WhatsApp**.
- **Marcar tag**.
- **Ações de funil** (operam sobre o card, com motivo e auditoria): mover etapa, qualificar, aplicar lead score, criar task, agendar follow-up, handoff humano.

## Construtor visual (estado real)

- Existe um construtor visual de fluxos (gatilhos, condições, ações).
- **Em desenvolvimento**: a paleta visual para as **ações de funil** ainda está sendo finalizada; hoje essas ações são configuradas pela equipe. O backend já as executa.

## Boas práticas

- Um fluxo por intenção; evitar sobreposição que gere resposta dobrada.
- Toda ação de funil registra histórico/auditoria.
- Combinar automação determinística (palavra-chave) com IA quando fizer sentido.

## O que NÃO prometer ainda

- Paleta visual completa das ações de funil (em finalização).
- Ações ainda não suportadas: enviar e-mail, transferência avançada, delay, "chamar agente IA" dentro do fluxo — confirmar antes de prometer.
- Disparo agendado por cron sem ação humana (assistido).
