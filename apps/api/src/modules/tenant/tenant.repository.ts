import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  membershipRoles,
  memberships,
  organizations,
  rolePermissions,
  roles,
  schema as databaseSchema,
  users,
} from "@approveflow/database";
import type {
  OrganizationSummary,
  TenantContext,
  TenantRepository,
} from "./tenant.types.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleTenantRepository implements TenantRepository {
  public constructor(private readonly database: Database) {}

  public async listActiveOrganizations(
    userId: string,
  ): Promise<readonly OrganizationSummary[]> {
    return this.database
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, "ACTIVE"),
          eq(organizations.status, "ACTIVE"),
          eq(users.status, "ACTIVE"),
        ),
      );
  }

  public async resolveActiveContext(
    userId: string,
    organizationId: string,
  ): Promise<TenantContext | null> {
    const [membership] = await this.database
      .select({
        id: memberships.id,
        fullName: users.fullName,
        email: users.email,
        organizationName: organizations.name,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(memberships.organizationId, organizations.id),
      )
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "ACTIVE"),
          eq(organizations.status, "ACTIVE"),
          eq(users.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (!membership) return null;

    const permissionRows = await this.database
      .select({ key: rolePermissions.permissionKey })
      .from(membershipRoles)
      .innerJoin(
        rolePermissions,
        and(
          eq(membershipRoles.organizationId, rolePermissions.organizationId),
          eq(membershipRoles.roleId, rolePermissions.roleId),
        ),
      )
      .innerJoin(
        roles,
        and(
          eq(rolePermissions.organizationId, roles.organizationId),
          eq(rolePermissions.roleId, roles.id),
        ),
      )
      .where(
        and(
          eq(membershipRoles.organizationId, organizationId),
          eq(membershipRoles.membershipId, membership.id),
          eq(roles.status, "ACTIVE"),
        ),
      );
    return {
      userId,
      fullName: membership.fullName,
      email: membership.email,
      organizationId,
      organizationName: membership.organizationName,
      membershipId: membership.id,
      permissions: new Set(permissionRows.map(({ key }) => key)),
    };
  }
}
