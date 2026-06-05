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
  // Funil SDR/Comercial padrão — etapas iniciais de um tenant novo.
  { name: 'Novo Lead', color: 'sky', type: 'NORMAL', order: 0 },
  { name: 'Primeiro contato', color: 'blue', type: 'NORMAL', order: 1 },
  { name: 'Em qualificação', color: 'indigo', type: 'NORMAL', order: 2 },
  { name: 'Qualificado', color: 'violet', type: 'NORMAL', order: 3 },
  { name: 'Aguardando resposta', color: 'amber', type: 'NORMAL', order: 4 },
  { name: 'Reunião agendada', color: 'purple', type: 'NORMAL', order: 5 },
  { name: 'Proposta enviada', color: 'pink', type: 'NORMAL', order: 6 },
  { name: 'Em negociação', color: 'orange', type: 'NORMAL', order: 7 },
  { name: 'Ganho', color: 'green', type: 'WON', order: 8 },
  { name: 'Perdido', color: 'red', type: 'LOST', order: 9 },
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
