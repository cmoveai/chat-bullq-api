import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { OrganizationsRepository } from './organizations.repository';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import {
  CustomContactFieldDto,
  SetCustomContactFieldsDto,
} from './dto/custom-contact-fields.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly repository: OrganizationsRepository) {}

  async getOrganization(orgId: string) {
    const org = await this.repository.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateOrganization(orgId: string, dto: UpdateOrganizationDto) {
    await this.getOrganization(orgId);
    const { aiBusinessHours, ...rest } = dto;
    return this.repository.update(orgId, {
      ...rest,
      ...(aiBusinessHours !== undefined
        ? { aiBusinessHours: aiBusinessHours as object }
        : {}),
    });
  }

  /**
   * Salva respostas do wizard de onboarding (experiência IA · objetivo · setores · tempo)
   * e marca org como onboardada. Idempotente · re-submeter sobrescreve respostas.
   */
  async completeOnboarding(
    orgId: string,
    dto: { experiencia: string; objetivo: string; setores: string[]; tempoMercado: string },
  ) {
    await this.getOrganization(orgId);
    const updated = await this.repository.update(orgId, {
      onboardingData: {
        experiencia: dto.experiencia,
        objetivo: dto.objetivo,
        setores: dto.setores,
        tempoMercado: dto.tempoMercado,
        completedAt: new Date().toISOString(),
      },
      onboardingCompletedAt: new Date(),
    });
    this.logger.log(`Onboarding completed for org ${orgId}`);
    return updated;
  }

  async getMembers(orgId: string) {
    return this.repository.findMembers(orgId);
  }

  async inviteMember(orgId: string, dto: InviteMemberDto, inviterId: string) {
    // Check if user already exists and is already a member
    const existingUser = await this.repository.findUserByEmail(dto.email);
    if (existingUser) {
      const existingMembership = await this.repository.findMembership(existingUser.id, orgId);
      if (existingMembership) {
        throw new ConflictException('User is already a member of this organization');
      }
    }

    // Create invitation (works for both existing and non-existing users)
    const invitation = await this.repository.createInvitation(orgId, dto.email, dto.role, inviterId);
    this.logger.log(`Invitation sent to ${dto.email} for org ${orgId} by ${inviterId}`);

    // If user already exists, auto-accept: add them to org immediately
    if (existingUser) {
      await this.repository.addMember(orgId, existingUser.id, dto.role);
      await this.repository.acceptInvitation(invitation.id);
      this.logger.log(`User ${dto.email} auto-added to org ${orgId} (already registered)`);
      return { ...invitation, status: 'ACCEPTED' as const, autoAccepted: true };
    }

    return { ...invitation, autoAccepted: false };
  }

  async validateInvitation(token: string) {
    const invitation = await this.repository.findInvitationByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    return {
      email: invitation.email,
      role: invitation.role,
      organization: invitation.organization,
    };
  }

  async getInvitations(orgId: string) {
    return this.repository.findInvitationsByOrg(orgId);
  }

  async revokeInvitation(orgId: string, invitationId: string) {
    const invitations = await this.repository.findInvitationsByOrg(orgId);
    const invitation = invitations.find((i) => i.id === invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found in this organization');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    return this.repository.revokeInvitation(invitationId);
  }

  async updateMemberRole(orgId: string, memberId: string, dto: UpdateMemberRoleDto, actorRole: OrgRole) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER' && dto.role !== 'OWNER') {
      throw new ForbiddenException('Cannot change the role of the organization owner');
    }

    if (actorRole === 'ADMIN' && dto.role === 'OWNER') {
      throw new ForbiddenException('Only owners can assign the owner role');
    }

    return this.repository.updateMemberRole(membership.id, dto.role);
  }

  async removeMember(orgId: string, memberId: string, actorId: string) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    if (memberId === actorId) {
      throw new BadRequestException('Cannot remove yourself. Transfer ownership first.');
    }

    await this.repository.removeMember(membership.id);
    this.logger.log(`Member ${memberId} removed from org ${orgId} by ${actorId}`);
  }

  // ─── Custom Contact Fields ─────────────────────
  //
  // Storage: `Organization.settings.customContactFields` (JSON array).
  // Values per contact stored in `Contact.metadata.customFields` (Record<id,value>).

  async getCustomContactFields(orgId: string): Promise<CustomContactFieldDto[]> {
    const org = await this.getOrganization(orgId);
    const settings = (org.settings as Record<string, unknown> | null) ?? {};
    const fields = settings['customContactFields'];
    if (!Array.isArray(fields)) return [];
    return fields as CustomContactFieldDto[];
  }

  async setCustomContactFields(
    orgId: string,
    dto: SetCustomContactFieldsDto,
  ): Promise<CustomContactFieldDto[]> {
    const org = await this.getOrganization(orgId);

    // Dedupe IDs · garante consistência (UI usa id como key)
    const seen = new Set<string>();
    for (const f of dto.fields) {
      if (seen.has(f.id)) {
        throw new BadRequestException(
          `Campo customizado com id duplicado: "${f.id}"`,
        );
      }
      seen.add(f.id);
      if (f.type === 'select' && (!f.options || f.options.length === 0)) {
        throw new BadRequestException(
          `Campo "${f.label}" do tipo select precisa de pelo menos uma opção`,
        );
      }
    }

    // Sort por order
    const sorted = [...dto.fields].sort((a, b) => a.order - b.order);

    const settings = (org.settings as Record<string, unknown> | null) ?? {};
    const next = {
      ...settings,
      customContactFields: sorted,
    };

    await this.repository.update(orgId, {
      settings: next as unknown as Prisma.InputJsonValue,
    });
    this.logger.log(
      `Custom contact fields atualizados em org ${orgId}: ${sorted.length} fields`,
    );
    return sorted;
  }
}
