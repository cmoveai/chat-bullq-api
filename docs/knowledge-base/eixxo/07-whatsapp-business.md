---
doc: 07-whatsapp-business
escopo: Canal WhatsApp — capacidades, janela, limites
agentes: Especialista de Produto, Onboarding Meta, Suporte Técnico
atualizado: 2026-06-04
---

# WhatsApp Business

Canal de WhatsApp do EIXXO para receber e responder mensagens dentro da plataforma, integrado ao funil e à IA.

## Capacidades (estado real)

- **Recebimento**: mensagens entram na caixa única, viram conversa e podem virar card.
- **Resposta dentro da janela de atendimento**: responder o cliente que falou com você funciona.
- **Automação e IA**: gatilho de mensagem (palavra-chave), respostas automáticas, qualificação e ações de funil — ver `08`/`10`.

## Conceitos importantes

- **Janela de atendimento (24h)**: após a última mensagem do cliente, há uma janela para responder livremente. Fora dela, a Meta exige **templates aprovados** para reabrir conversa.
- **Templates**: mensagens pré-aprovadas pela Meta para envio fora da janela. Sujeitas a aprovação e categorias.
- **Qualidade do número**: a Meta monitora qualidade; envio inadequado pode restringir o número.

## Limites e dependências (ser transparente)

- Envio **proativo/em massa** e uso de templates em escala dependem de **aprovação Meta** e da verificação da empresa.
- O EIXXO não faz disparo não-oficial; tudo é via API oficial.
- Capacidades amplas de envio estão **gated** até a aprovação concluir.

## Suporte/diagnóstico (encaminhar a `12` quando técnico)

- Mensagem não chega → verificar conexão/webhook do canal.
- Não consegue responder fora da janela → é regra da Meta (template necessário), não é erro.

## O que NÃO prometer ainda

- Disparo em massa/proativo irrestrito.
- Templates ilimitados sem aprovação Meta.
- Garantia de não-bloqueio do número (depende do uso e da Meta).
