import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  departments,
  membershipDepartments,
  membershipRoles,
  memberships,
  roles,
  schema as databaseSchema,
  users,
} from "@approveflow/database";
import type {
  ApproverMembershipOption,
  ApproverOptionRepository,
} from "./approver-options.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleApproverOptionRepository implements ApproverOptionRepository {
  public constructor(private readonly database: Database) {}

  public async listMemberships(
    organizationId: string,
  ): Promise<readonly ApproverMembershipOption[]> {
    const members = await this.database
      .select({
        id: memberships.id,
        fullName: users.fullName,
        email: users.email,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(asc(users.fullName), asc(users.email));
    const roleRows = await this.database
      .select({
        membershipId: membershipRoles.membershipId,
        id: roles.id,
        name: roles.name,
      })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.organizationId, organizationId));
    const departmentRows = await this.database
      .select({
        membershipId: membershipDepartments.membershipId,
        id: departments.id,
        name: departments.name,
      })
      .from(membershipDepartments)
      .innerJoin(
        departments,
        eq(departments.id, membershipDepartments.departmentId),
      )
      .where(eq(membershipDepartments.organizationId, organizationId));
    return members.map((member) => ({
      ...member,
      roles: roleRows
        .filter((role) => role.membershipId === member.id)
        .map(({ id, name }) => ({ id, name })),
      departments: departmentRows
        .filter((department) => department.membershipId === member.id)
        .map(({ id, name }) => ({ id, name })),
    }));
  }

  public listRoles(organizationId: string) {
    return this.database
      .select({ id: roles.id, name: roles.name, status: roles.status })
      .from(roles)
      .where(eq(roles.organizationId, organizationId))
      .orderBy(asc(roles.name));
  }

  public listDepartments(organizationId: string) {
    return this.database
      .select({
        id: departments.id,
        name: departments.name,
        status: departments.status,
      })
      .from(departments)
      .where(eq(departments.organizationId, organizationId))
      .orderBy(asc(departments.name));
  }
}
