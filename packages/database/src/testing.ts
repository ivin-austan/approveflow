import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "./index.js";
import { memberships, organizations, users } from "./schema.js";

export async function createTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests",
    );
  }
  const database = createDatabase(connectionString);
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  return database;
}

export async function resetTestDatabase(
  database: ReturnType<typeof createDatabase>["db"],
): Promise<void> {
  await database.execute(
    sql.raw(`
    TRUNCATE TABLE
      stage_escalation_rules, stage_reminder_rules, stage_approvers,
      workflow_stages, field_conditions, field_options, form_fields,
      form_sections, workflow_versions, workflows, document_types,
      business_calendar_holidays, business_calendar_work_periods,
      business_calendars,
      invitation_departments, invitation_roles, invitations,
      membership_departments, membership_roles, role_permissions,
      sessions, departments, roles, memberships, organizations, users,
      permissions
    RESTART IDENTITY CASCADE
  `),
  );
}

export async function createUserFactory(
  database: ReturnType<typeof createDatabase>["db"],
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [user] = await database
    .insert(users)
    .values({
      email: `user-${crypto.randomUUID()}@example.com`,
      fullName: "Test User",
      passwordHash: "test-password-hash",
      ...overrides,
    })
    .returning();
  if (!user) throw new Error("User factory failed");
  return user;
}

export async function createOrganizationFactory(
  database: ReturnType<typeof createDatabase>["db"],
  overrides: Partial<typeof organizations.$inferInsert> = {},
) {
  const [organization] = await database
    .insert(organizations)
    .values({
      name: "Test Organization",
      slug: `test-${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning();
  if (!organization) throw new Error("Organization factory failed");
  return organization;
}

export async function createMembershipFactory(
  database: ReturnType<typeof createDatabase>["db"],
  input: {
    readonly organizationId: string;
    readonly userId: string;
  } & Partial<typeof memberships.$inferInsert>,
) {
  const [membership] = await database
    .insert(memberships)
    .values(input)
    .returning();
  if (!membership) throw new Error("Membership factory failed");
  return membership;
}
