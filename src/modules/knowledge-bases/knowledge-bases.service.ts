import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeBaseSourceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateKbTextDto,
  KB_MAX_CONTENT_LENGTH,
  LinkAgentsDto,
  UpdateKbDto,
} from './dto/knowledge-base.dto';

interface UploadFileMeta {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class KnowledgeBasesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Read ──────────────────────────────────────

  async list(organizationId: string) {
    return this.prisma.knowledgeBase.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        organizationId: true,
        name: true,
        description: true,
        sourceType: true,
        sourceFilename: true,
        sourceMimeType: true,
        sourceSizeBytes: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { agentLinks: true } },
      },
    });
  }

  async getById(id: string, organizationId: string, includeContent = false) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: {
        agentLinks: {
          select: {
            agent: {
              select: { id: true, name: true, kind: true },
            },
          },
        },
      },
    });
    if (!kb) throw new NotFoundException('Base de conhecimento não encontrada');
    if (!includeContent) {
      // Trim content pra preview
      return { ...kb, contentPreview: kb.content.slice(0, 500), content: undefined };
    }
    return kb;
  }

  // ─── Write ─────────────────────────────────────

  async createFromText(organizationId: string, dto: CreateKbTextDto) {
    return this.prisma.knowledgeBase.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description ?? null,
        content: dto.content,
        sourceType: KnowledgeBaseSourceType.TEXT,
      },
    });
  }

  async createFromUpload(
    organizationId: string,
    file: UploadFileMeta,
    name?: string,
    description?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Arquivo ausente');
    const text = await this.extractText(file);
    if (text.length === 0) {
      throw new BadRequestException(
        'Não foi possível extrair texto do arquivo · talvez seja imagem/PDF escaneado',
      );
    }
    if (text.length > KB_MAX_CONTENT_LENGTH) {
      throw new BadRequestException(
        `Texto extraído (${text.length} chars) excede o limite de ${KB_MAX_CONTENT_LENGTH}`,
      );
    }

    return this.prisma.knowledgeBase.create({
      data: {
        organizationId,
        name: name?.trim() || file.originalname,
        description: description?.trim() || null,
        content: text,
        sourceType: KnowledgeBaseSourceType.UPLOAD,
        sourceFilename: file.originalname,
        sourceMimeType: file.mimetype,
        sourceSizeBytes: file.size,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateKbDto) {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Base não encontrada');

    const data: Prisma.KnowledgeBaseUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.content !== undefined) data.content = dto.content;

    return this.prisma.knowledgeBase.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Base não encontrada');

    await this.prisma.knowledgeBase.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  // ─── Agent ↔ KB link ───────────────────────────

  async linkAgents(
    knowledgeBaseId: string,
    organizationId: string,
    dto: LinkAgentsDto,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, organizationId, deletedAt: null },
    });
    if (!kb) throw new NotFoundException('Base não encontrada');

    const validAgents = await this.prisma.aiAgent.findMany({
      where: { id: { in: dto.agentIds }, organizationId },
      select: { id: true },
    });
    const validIds = new Set(validAgents.map((a) => a.id));
    const filtered = dto.agentIds.filter((id) => validIds.has(id));

    // Substitui (replace full)
    await this.prisma.$transaction(async (tx) => {
      await tx.agentKnowledgeBase.deleteMany({
        where: { knowledgeBaseId },
      });
      await tx.agentKnowledgeBase.createMany({
        data: filtered.map((agentId) => ({
          agentId,
          knowledgeBaseId,
        })),
        skipDuplicates: true,
      });
    });

    return { ok: true, linked: filtered.length };
  }

  async getKbByAgent(agentId: string, organizationId: string) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, organizationId },
      select: { id: true },
    });
    if (!agent) throw new NotFoundException('Agente não encontrado');

    const links = await this.prisma.agentKnowledgeBase.findMany({
      where: { agentId },
      include: {
        knowledgeBase: {
          select: {
            id: true,
            name: true,
            description: true,
            sourceType: true,
          },
        },
      },
    });
    return links.map((l) => l.knowledgeBase);
  }

  // ─── Helper · text extraction ──────────────────

  private async extractText(file: UploadFileMeta): Promise<string> {
    const { mimetype, buffer, originalname } = file;
    const lower = (originalname || '').toLowerCase();

    // Plain text · simples
    if (
      mimetype === 'text/plain' ||
      mimetype === 'text/markdown' ||
      lower.endsWith('.txt') ||
      lower.endsWith('.md')
    ) {
      return buffer.toString('utf-8').trim();
    }

    // CSV · trata como texto puro
    if (mimetype === 'text/csv' || lower.endsWith('.csv')) {
      return buffer.toString('utf-8').trim();
    }

    // PDF
    if (mimetype === 'application/pdf' || lower.endsWith('.pdf')) {
      try {
        // dynamic require (pdf-parse opcional)
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buffer);
        return (parsed.text || '').trim();
      } catch (err) {
        throw new BadRequestException(
          'Falha ao extrair PDF · biblioteca pdf-parse não disponível. Use TXT/MD por ora.',
        );
      }
    }

    // DOCX · usa mammoth
    if (
      mimetype ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      lower.endsWith('.docx')
    ) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return (result.value || '').trim();
      } catch (err) {
        throw new BadRequestException(
          'Falha ao extrair DOCX · biblioteca mammoth não disponível. Use TXT/MD por ora.',
        );
      }
    }

    throw new BadRequestException(
      `Formato de arquivo não suportado: ${mimetype}. Suportados: TXT, MD, CSV, PDF, DOCX`,
    );
  }
}
