# Knowledge Base — EIXXO

Base de conhecimento modular e versionada que alimenta os **agentes próprios do EIXXO**. Cada agente consome apenas os documentos relevantes à sua função (ver matriz). O conteúdo NÃO vive dentro do `system_prompt`: os prompts referenciam esta base, que é injetada de forma modular.

> **EIXXO é o produto** — a plataforma omnichannel + CRM + automações + IA vendida ao cliente.
> **CMOVE.AI é a empresa** que opera o produto. Esta base fala SOMENTE da plataforma EIXXO ao cliente. Nada da operação interna da CMOVE entra aqui.

## Documentos

| # | Arquivo | Escopo |
|---|---|---|
| — | `README.md` | Índice, matriz, regras de atualização |
| 00 | `00-visao-geral-eixxo.md` | O que é o EIXXO, posicionamento, pilares |
| 01 | `01-produto-e-modulos.md` | Módulos e estado real (pronto / gated / em desenvolvimento) |
| 02 | `02-publico-alvo-e-icp.md` | ICP, segmentos, dores, sinais de qualificação |
| 03 | `03-playbook-comercial.md` | Valor, descoberta, objeções, comparação estratégica |
| 04 | `04-playbook-sdr.md` | Roteiro de qualificação e diagnóstico |
| 05 | `05-playbook-closer.md` | Condução de fechamento, ganho/perda |
| 06 | `06-onboarding-meta.md` | WABA, IG Business, Embedded Signup, verificação |
| 07 | `07-whatsapp-business.md` | Canal WhatsApp: capacidades e limites |
| 08 | `08-instagram-automation.md` | DM + comentário→DM, gatilhos, paralelo ManyChat |
| 09 | `09-crm-funil-e-cards.md` | cards=deals, stages, tasks, score, histórico |
| 10 | `10-automacoes-e-flow-builder.md` | Automações/BPMN: gatilhos, condições, ações |
| 11 | `11-capi-pixel-e-atribuicao.md` | Pixel, Dataset, CAPI (em desenvolvimento) |
| 12 | `12-suporte-tecnico.md` | Diagnóstico operacional |
| 13 | `13-customer-success.md` | Adoção, organização, churn |
| 14 | `14-regras-de-seguranca.md` | Multi-tenant, RLS, auditoria |
| 15 | `15-respostas-padrao.md` | Respostas-modelo no tom oficial |

## Matriz agente → documentos

| Agente | Documentos |
|---|---|
| EIXXO Orquestrador | 00, 01, 02, 14, 15 |
| EIXXO SDR | 00, 01, 02, 03, 04, 09, 14, 15 |
| EIXXO Especialista de Produto | 00, 01, 07, 08, 09, 10, 11, 14, 15 |
| EIXXO Onboarding Meta | 00, 01, 06, 07, 08, 11, 14, 15 |
| EIXXO Suporte Técnico | 00, 01, 07, 08, 09, 10, 12, 14, 15 |
| EIXXO Customer Success | 00, 01, 09, 10, 13, 14, 15 |
| EIXXO Sales Closer | 00, 01, 02, 03, 05, 09, 14, 15 |

`00`, `14` e `15` são base comum a todos.

## Regras de atualização

- Toda mudança de estado da plataforma (uma feature saiu de "em desenvolvimento" para "pronto") atualiza o doc correspondente **e** o bloco "O que NÃO prometer".
- A fonte da verdade do estado real é o código/validações no repo — a base reflete, não antecipa.
- Mudança em arquitetura comercial (cards=deals, tasks=activities) atualiza `09` e os playbooks.
- Versionar toda alteração (commit). Sem editar conteúdo em produção sem passar pelo repo.

## Regra EIXXO ≠ CMOVE

- Conteúdo exclusivo do produto EIXXO. Proibido importar/duplicar material da operação CMOVE (clientes, finanças, agentes internos, processos).
- Os agentes EIXXO são marcados com prefixo `EIXXO` e consomem apenas KBs EIXXO.
- Hoje rodam no mesmo tenant (org CMOVE.AI) por decisão de dogfood; um tenant EIXXO dedicado pode ser criado no futuro e esta base migra junto, sem reescrita.

## Tom

Profissional, direto, consultivo. Sem exagero, sem emoji, sem atacar concorrentes, sem prometer o que a plataforma ainda não entrega. Foco em diagnóstico, orientação e próximo passo.
