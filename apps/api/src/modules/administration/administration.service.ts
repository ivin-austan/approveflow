import { randomBytes, randomUUID } from "node:crypto";
import { hashRefreshToken } from "../auth/auth.crypto.js";

export class AdministrationValidationError extends Error {}
export class AdministrationReferenceError extends Error {}

export interface AdministrationRepository {
  createDepartment(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly code: string;
  }): Promise<void>;
  createRole(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly permissionKeys: readonly string[];
  }): Promise<void>;
  setMembershipConfiguration(input: {
    readonly organizationId: string;
    readonly membershipId: string;
    readonly reportingManagerMembershipId: string | null;
    readonly departmentIds: readonly string[];
    readonly defaultDepartmentId: string;
    readonly roleIds: readonly string[];
  }): Promise<boolean>;
  createInvitation(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly email: string;
    readonly fullName: string;
    readonly tokenHash: string;
    readonly invitedByMembershipId: string;
    readonly expiresAt: Date;
    readonly departmentIds: readonly string[];
    readonly defaultDepartmentId: string;
    readonly roleIds: readonly string[];
  }): Promise<boolean>;
  revokeInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly revokedAt: Date;
  }): Promise<boolean>;
}

export class AdministrationService {
  public constructor(
    private readonly repository: AdministrationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createDepartment(
    organizationId: string,
    input: { readonly name: string; readonly code: string },
  ) {
    const id = randomUUID();
    await this.repository.createDepartment({
      id,
      organizationId,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
    });
    return { id };
  }

  public async createRole(
    organizationId: string,
    input: {
      readonly name: string;
      readonly permissionKeys: readonly string[];
    },
  ) {
    const id = randomUUID();
    await this.repository.createRole({
      id,
      organizationId,
      name: input.name.trim(),
      permissionKeys: [...new Set(input.permissionKeys)],
    });
    return { id };
  }

  public async configureMembership(
    organizationId: string,
    membershipId: string,
    input: {
      readonly reportingManagerMembershipId: string | null;
      readonly departmentIds: readonly string[];
      readonly defaultDepartmentId: string;
      readonly roleIds: readonly string[];
    },
  ): Promise<void> {
    const departments = [...new Set(input.departmentIds)];
    if (!departments.includes(input.defaultDepartmentId)) {
      throw new AdministrationValidationError(
        "Default department must be one of the membership departments",
      );
    }
    if (input.reportingManagerMembershipId === membershipId) {
      throw new AdministrationValidationError(
        "A membership cannot manage itself",
      );
    }
    const updated = await this.repository.setMembershipConfiguration({
      organizationId,
      membershipId,
      reportingManagerMembershipId: input.reportingManagerMembershipId,
      departmentIds: departments,
      defaultDepartmentId: input.defaultDepartmentId,
      roleIds: [...new Set(input.roleIds)],
    });
    if (!updated)
      throw new AdministrationReferenceError("Invalid tenant reference");
  }

  public async invite(
    organizationId: string,
    invitedByMembershipId: string,
    input: {
      readonly email: string;
      readonly fullName: string;
      readonly departmentIds: readonly string[];
      readonly defaultDepartmentId: string;
      readonly roleIds: readonly string[];
    },
  ) {
    const departments = [...new Set(input.departmentIds)];
    if (!departments.includes(input.defaultDepartmentId)) {
      throw new AdministrationValidationError(
        "Default department must be one of the invitation departments",
      );
    }
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now());
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
    const id = randomUUID();
    const created = await this.repository.createInvitation({
      id,
      organizationId,
      email: input.email.trim().toLowerCase(),
      fullName: input.fullName.trim(),
      tokenHash: hashRefreshToken(secret),
      invitedByMembershipId,
      expiresAt,
      departmentIds: departments,
      defaultDepartmentId: input.defaultDepartmentId,
      roleIds: [...new Set(input.roleIds)],
    });
    if (!created)
      throw new AdministrationReferenceError("Invalid tenant reference");
    return { id, secret, expiresAt };
  }

  public async revokeInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const revoked = await this.repository.revokeInvitation({
      organizationId,
      invitationId,
      revokedAt: this.now(),
    });
    if (!revoked)
      throw new AdministrationReferenceError("Invitation not found");
  }
}
