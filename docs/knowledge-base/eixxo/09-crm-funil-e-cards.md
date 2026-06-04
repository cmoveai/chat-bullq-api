---
doc: 09-crm-funil-e-cards
escopo: CRM — cards=deals, pipelines/stages, tasks=activities, score, histórico
agentes: SDR, Especialista de Produto, Suporte Técnico, Customer Success, Sales Closer, Orquestrador (parcial)
atualizado: 2026-06-04
---

# CRM, funil e cards

O CRM do EIXXO organiza a oportunidade comercial. Vocabulário oficial (não inventar termos paralelos):

- **Card = deal/oportunidade**. Não existe entidade "deal" separada; o card É a oportunidade.
- **Pipeline = funil**; **Stage = etapa** do funil. Etapas têm tipo: normal, ganho (WON) ou perda (LOST).
- **Task = atividade** comercial (ligar, enviar proposta, follow-up).
- O card carrega: título, valor, contato, conversa, responsável, **lead score**, **status de qualificação**, etapa, status (aberto/ganho/perdido) e motivo de fechamento.

## Campos de SDR no card

- **lead_score**: pontuação do lead.
- **qualification_status**: NEW, QUALIFYING, QUALIFIED, DISQUALIFIED.
- **next_followup_at**: próximo retorno agendado.

## Movimentação e histórico (auditoria)

- Toda mudança de etapa/status passa por uma camada segura e grava **card_stage_history** (de/para etapa e status, quem moveu, motivo, contexto, data).
- Ganho/perda exige **motivo** (closed_reason), registrado no card e no histórico.
- Ações de agente também gravam **sdr_action_log** (auditoria de cada ação: qualificar, score, mover, follow-up, task, handoff, ganho/perda).

## Como os agentes operam o funil

Sempre por ferramentas seguras — nunca alterando o card "por fora":
- qualificar, lead score, mover etapa, agendar follow-up (gera task + data), criar task, handoff, marcar ganho/perda.
- Cada ação exige motivo; ganho/perda e movimentação são rastreáveis.

## O que NÃO prometer ainda

- Relatórios comerciais avançados além do funil/histórico básicos (confirmar antes).
- Disparo automático de follow-up sem ação humana (o follow-up gera task e data; a execução automática é assistida).
- Integração com CRMs externos (confirmar; não prometer sem validação).
