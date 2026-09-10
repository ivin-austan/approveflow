import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  departments,
  membershipDepartments,
  membershipRoles,
  memberships,
  organizations,
  permissions,
  rolePermissions,
  roles,
  schema as databaseSchema,
  users,
} from "@approveflow/database";
import type {
  OnboardingInput,
  OnboardingRepository,
  OnboardingResult,
} from "./onboarding.types.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleOnboardingRepository implements OnboardingRepository {
  public constructor(private readonly database: Database) {}

  public createOrganizationAccount(
    input: OnboardingInput,
  ): Promise<OnboardingResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.insert(users).values({
        id: input.userId,
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
      });
      await transaction.insert(organizations).values({
        id: input.organizationId,
        name: input.organizationName,
        slug: input.organizationSlug,
      });
      await transaction.insert(memberships).values({
        id: input.membershipId,
        organizationId: input.organizationId,
        userId: input.userId,
      });
      await transaction.insert(departments).values({
        id: input.departmentId,
        organizationId: input.organizationId,
        name: "General",
        code: "GENERAL",
      });
      await transaction.insert(membershipDepartments).values({
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        departmentId: input.departmentId,
        isDefault: true,
      });
      await transaction.insert(roles).values({
        id: input.roleId,
        organizationId: input.organizationId,
        name: "Organization Admin",
      });
      await transaction
        .insert(permissions)
        .values(input.permissionKeys.map((key) => ({ key, description: key })))
        .onConflictDoNothing();
      await transaction.insert(rolePermissions).values(
        input.permissionKeys.map((permissionKey) => ({
          organizationId: input.organizationId,
          roleId: input.roleId,
          permissionKey,
        })),
      );
      await transaction.insert(membershipRoles).values({
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        roleId: input.roleId,
      });
      return {
        userId: input.userId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
      };
    });
  }
}
