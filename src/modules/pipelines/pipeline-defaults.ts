import { PipelineStageType } from '@prisma/client';

/**
 * Estágios padrão de um pipeline novo. Fonte única — usado pelo
 * `PipelinesService.createPipeline` (quando o cliente não manda estágios) e
 * pelo provisionamento automático no signup da org.
 */
export const DEFAULT_PIPELINE_STAGES: {
  name: string;
  color: string;
  type: 'NORMAL' | 'WON' | 'LOST';
  order: number;
}[] = [
  { name: 'Boas-vindas', color: 'sky', type: 'NORMAL', order: 0 },
  { name: 'Lead', color: 'blue', type: 'NORMAL', order: 1 },
  { name: 'Novo Ticket', color: 'indigo', type: 'NORMAL', order: 2 },
  { name: 'Configuração', color: 'violet', type: 'NORMAL', order: 3 },
  { name: 'Em Andamento', color: 'amber', type: 'NORMAL', order: 4 },
  { name: 'Qualificado', color: 'purple', type: 'NORMAL', order: 5 },
  { name: 'Aguardando Cliente', color: 'fuchsia', type: 'NORMAL', order: 6 },
  { name: 'Proposta', color: 'pink', type: 'NORMAL', order: 7 },
  { name: 'Treinamento', color: 'yellow', type: 'NORMAL', order: 8 },
  { name: 'Ativo', color: 'emerald', type: 'NORMAL', order: 9 },
  { name: 'Negociação', color: 'orange', type: 'NORMAL', order: 10 },
  { name: 'Resolvido', color: 'teal', type: 'NORMAL', order: 11 },
  { name: 'Fechado', color: 'green', type: 'WON', order: 12 },
  { name: 'Ganho', color: 'green', type: 'WON', order: 13 },
  { name: 'Perdido', color: 'red', type: 'LOST', order: 14 },
];

/**
 * Garante que a org tenha um pipeline default com estágios. Idempotente:
 * no-op se já existir um pipeline default não-arquivado. Best-effort — quem
 * chama (signup) trata erro sem derrubar o fluxo. Sem um pipeline default,
 * o auto-card de conversas novas (conversation-resolver) fica inerte e
 * nenhum lead entra no CRM.
 */
export async function provisionDefaultPipeline(
  prisma: {
    pipeline: {
      findFirst: (args: any) => Promise<any>;
      create: (args: any) => Promise<any>;
    };
  },
  organizationId: string,
  name = 'Funil de Vendas',
): Promise<{ id: string } | null> {
  const existing = await prisma.pipeline.findFirst({
    where: { organizationId, isDefault: true, archived: false },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.pipeline.create({
    data: {
      organizationId,
      name,
      isDefault: true,
      order: 0,
      stages: {
        create: DEFAULT_PIPELINE_STAGES.map((s) => ({
          name: s.name,
          color: s.color,
          type: s.type as PipelineStageType,
          order: s.order,
        })),
      },
    },
    select: { id: true },
  });
}
