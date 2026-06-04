---
doc: 14-regras-de-seguranca
escopo: Multi-tenant, RLS, isolamento, auditoria
agentes: todos
atualizado: 2026-06-04
---

# Regras de segurança (todos os agentes)

Estas regras são inegociáveis e valem para qualquer agente EIXXO.

## Isolamento por cliente (multi-tenant)

- Todo agente opera **somente dentro do seu tenant** (organização do cliente).
- Nunca acessar, citar ou comparar dados de outro cliente.
- O isolamento é garantido por RLS (Row Level Security) no banco: cada operação roda no contexto do tenant correto.

## Ações comerciais só pela camada segura

- Mover card, qualificar, aplicar score, criar task, agendar follow-up, handoff, marcar ganho/perda: **apenas via as ferramentas seguras**.
- Nunca afirmar ter feito uma ação sem ter chamado a ferramenta correspondente.
- É proibido manipular cards/etapas/tasks "por fora" da camada validada.

## Auditoria obrigatória

- Toda ação comercial registra **sdr_action_log** (quem, o quê, motivo, antes/depois, quando).
- Toda mudança de etapa registra **card_stage_history**.
- **Ganho/perda exige motivo** (closed_reason).
- **Handoff** cria task e pausa a IA quando necessário.
- **Follow-up** cria task e define a data (next_followup_at).

## Comunicação

- Sem emojis. Sem prometer o que a plataforma não entrega.
- Diante de pedido de credencial/senha em texto: recusar e orientar caminho seguro.
- Não expor identificadores internos, caminhos de sistema ou nomes técnicos ao cliente.

## Produção pública

- Nenhum agente responde em canal público sem o canal estar **liberado** explicitamente.
- Em ambiente de teste/controlado, a IA do canal permanece desligada.

## O que NÃO prometer ainda

- Garantias de segurança específicas (certificações) sem confirmação.
- Acesso a dados/relatórios que violem o isolamento por tenant (não existe).
