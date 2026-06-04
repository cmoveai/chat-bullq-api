import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ContactsRepository } from './contacts.repository';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ContactsService {
  constructor(
    private readonly repository: ContactsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async stats(organizationId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const where = { organizationId, deletedAt: null };
    const [total, withEmail, withPhone, today] = await this.prisma.$transaction(async (tx) => [
      await tx.contact.count({ where }),
      await tx.contact.count({
        where: { ...where, email: { not: null } },
      }),
      await tx.contact.count({
        where: { ...where, phone: { not: null } },
      }),
      await tx.contact.count({
        where: { ...where, createdAt: { gte: startOfToday } },
      }),
    ]);

    return { total, withEmail, withPhone, today };
  }

  async findAll(organizationId: string, search: string | undefined, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { contacts, total } = await this.repository.findByOrg(organizationId, search, skip, limit);
    return {
      contacts,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, organizationId: string) {
    const contact = await this.repository.findById(id);
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.organizationId !== organizationId) throw new ForbiddenException();
    return contact;
  }

  async update(id: string, organizationId: string, dto: UpdateContactDto) {
    await this.findOne(id, organizationId);
    return this.repository.update(id, dto);
  }

  async remove(id: string, organizationId: string) {
    await this.findOne(id, organizationId);
    return this.repository.softDelete(id);
  }
}
