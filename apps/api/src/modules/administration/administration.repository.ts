import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  departments,
  invitationDepartments,
  invitationRoles,
  invitations,
  membershipDepartments,
  membershipRoles,
  memberships,
  permissions,
  rolePermissions,
  roles,
  schema as databaseSchema,
} from "@approveflow/database";
import type { AdministrationRepository } from "./administration.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleAdministrationRepository implements AdministrationRepository {
  public constructor(private readonly database: Database) {}

  public async createDepartment(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly code: string;
  }): Promise<void> {
    await this.database.insert(departments).values(input);
  }

  public createRole(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly permissionKeys: readonly string[];
  }): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const known =
        input.permissionKeys.length === 0
          ? []
          : await transaction
              .select({ key: permissions.key })
              .from(permissions)
              .where(inArray(permissions.key, [...input.permissionKeys]));
      if (known.length !== input.permissionKeys.length) {
        throw new Error("Unknown permission key");
      }
      await transaction.insert(roles).values({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
      });
      if (input.permissionKeys.length > 0) {
        await transaction.insert(rolePermissions).values(
          input.permissionKeys.map((permissionKey) => ({
            organizationId: input.organizationId,
            roleId: input.id,
            permissionKey,
          })),
        );
      }
    });
  }

  public setMembershipConfiguration(input: {
    readonly organizationId: string;
    readonly membershipId: string;
    readonly reportingManagerMembershipId: string | null;
    readonly departmentIds: readonly string[];
    readonly defaultDepartmentId: string;
    readonly roleIds: readonly string[];
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [membership] = await transaction
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.id, input.membershipId),
          ),
        );
      if (!membership) return false;
      const departmentsFound = await transaction
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            eq(departments.organizationId, input.organizationId),
            inArray(departments.id, [...input.departmentIds]),
          ),
        );
      const rolesFound =
        input.roleIds.length === 0
          ? []
          : await transaction
              .select({ id: roles.id })
              .from(roles)
              .where(
                and(
                  eq(roles.organizationId, input.organizationId),
                  inArray(roles.id, [...input.roleIds]),
                ),
              );
      if (
        departmentsFound.length !== input.departmentIds.length ||
        rolesFound.length !== input.roleIds.length
      ) {
        return false;
      }
      if (input.reportingManagerMembershipId) {
        const [manager] = await transaction
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, input.organizationId),
              eq(memberships.id, input.reportingManagerMembershipId),
              eq(memberships.status, "ACTIVE"),
            ),
          );
        if (!manager) return false;
      }
      await transaction
        .update(memberships)
        .set({
          reportingManagerMembershipId: input.reportingManagerMembershipId,
        })
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.id, input.membershipId),
          ),
        );
      await transaction
        .delete(membershipDepartments)
        .where(
          and(
            eq(membershipDepartments.organizationId, input.organizationId),
            eq(membershipDepartments.membershipId, input.membershipId),
          ),
        );
      await transaction.insert(membershipDepartments).values(
        input.departmentIds.map((departmentId) => ({
          organizationId: input.organizationId,
          membershipId: input.membershipId,
          departmentId,
          isDefault: departmentId === input.defaultDepartmentId,
        })),
      );
      await transaction
        .delete(membershipRoles)
        .where(
          and(
            eq(membershipRoles.organizationId, input.organizationId),
            eq(membershipRoles.membershipId, input.membershipId),
          ),
        );
      if (input.roleIds.length > 0) {
        await transaction.insert(membershipRoles).values(
          input.roleIds.map((roleId) => ({
            organizationId: input.organizationId,
            membershipId: input.membershipId,
            roleId,
          })),
        );
      }
      return true;
    });
  }

  public createInvitation(input: {
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
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const departmentCount = await transaction
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            eq(departments.organizationId, input.organizationId),
            eq(departments.status, "ACTIVE"),
            inArray(departments.id, [...input.departmentIds]),
          ),
        );
      const roleCount =
        input.roleIds.length === 0
          ? []
          : await transaction
              .select({ id: roles.id })
              .from(roles)
              .where(
                and(
                  eq(roles.organizationId, input.organizationId),
                  eq(roles.status, "ACTIVE"),
                  inArray(roles.id, [...input.roleIds]),
                ),
              );
      if (
        departmentCount.length !== input.departmentIds.length ||
        roleCount.length !== input.roleIds.length
      ) {
        return false;
      }
      await transaction.insert(invitations).values({
        id: input.id,
        organizationId: input.organizationId,
        email: input.email,
        fullName: input.fullName,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        invitedByMembershipId: input.invitedByMembershipId,
      });
      await transaction.insert(invitationDepartments).values(
        input.departmentIds.map((departmentId) => ({
          organizationId: input.organizationId,
          invitationId: input.id,
          departmentId,
          isDefault: departmentId === input.defaultDepartmentId,
        })),
      );
      if (input.roleIds.length > 0) {
        await transaction.insert(invitationRoles).values(
          input.roleIds.map((roleId) => ({
            organizationId: input.organizationId,
            invitationId: input.id,
            roleId,
          })),
        );
      }
      return true;
    });
  }

  public async revokeInvitation(input: {
    readonly organizationId: string;
    readonly invitationId: string;
    readonly revokedAt: Date;
  }): Promise<boolean> {
    const [updated] = await this.database
      .update(invitations)
      .set({ status: "REVOKED", updatedAt: input.revokedAt })
      .where(
        and(
          eq(invitations.organizationId, input.organizationId),
          eq(invitations.id, input.invitationId),
          eq(invitations.status, "PENDING"),
        ),
      )
      .returning({ id: invitations.id });
    return Boolean(updated);
  }
}
