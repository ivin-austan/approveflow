import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const organizationStatus = pgEnum("organization_status", [
  "ACTIVE",
  "SUSPENDED",
]);
export const membershipStatus = pgEnum("membership_status", [
  "ACTIVE",
  "SUSPENDED",
]);
export const departmentStatus = pgEnum("department_status", [
  "ACTIVE",
  "ARCHIVED",
]);
export const roleStatus = pgEnum("role_status", ["ACTIVE", "ARCHIVED"]);
export const invitationStatus = pgEnum("invitation_status", [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: userStatus("status").notNull().default("ACTIVE"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: organizationStatus("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    reportingManagerMembershipId: uuid("reporting_manager_membership_id"),
    status: membershipStatus("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("memberships_organization_user_unique").on(
      table.organizationId,
      table.userId,
    ),
    uniqueIndex("memberships_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("memberships_user_status_idx").on(table.userId, table.status),
    foreignKey({
      columns: [table.organizationId, table.reportingManagerMembershipId],
      foreignColumns: [table.organizationId, table.id],
      name: "memberships_manager_same_organization_fk",
    }),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: departmentStatus("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("departments_organization_name_unique").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("departments_organization_code_unique").on(
      table.organizationId,
      table.code,
    ),
    uniqueIndex("departments_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
  ],
);

export const membershipDepartments = pgTable(
  "membership_departments",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.departmentId] }),
    uniqueIndex("membership_departments_default_unique")
      .on(table.membershipId)
      .where(sql`${table.isDefault} = true`),
    index("membership_departments_tenant_idx").on(
      table.organizationId,
      table.departmentId,
      table.membershipId,
    ),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_departments_membership_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: "membership_departments_department_tenant_fk",
    }),
  ],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    status: roleStatus("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("roles_organization_name_unique").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("roles_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "role_permissions_role_tenant_fk",
    }),
  ],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (table) => [
    primaryKey({ columns: [table.membershipId, table.roleId] }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "membership_roles_membership_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "membership_roles_role_tenant_fk",
    }),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenFamilyId: uuid("token_family_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBySessionId: uuid("replaced_by_session_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sessions_refresh_token_hash_unique").on(
      table.refreshTokenHash,
    ),
    index("sessions_user_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("sessions_family_idx").on(table.tokenFamilyId),
    foreignKey({
      columns: [table.replacedBySessionId],
      foreignColumns: [table.id],
      name: "sessions_replacement_fk",
    }),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: invitationStatus("status").notNull().default("PENDING"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedByMembershipId: uuid("invited_by_membership_id")
      .notNull()
      .references(() => memberships.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invitations_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_tenant_email_idx").on(
      table.organizationId,
      table.email,
      table.status,
    ),
  ],
);

export const invitationRoles = pgTable(
  "invitation_roles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.roleId] }),
    foreignKey({
      columns: [table.organizationId, table.invitationId],
      foreignColumns: [invitations.organizationId, invitations.id],
      name: "invitation_roles_invitation_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "invitation_roles_role_tenant_fk",
    }),
  ],
);

export const invitationDepartments = pgTable(
  "invitation_departments",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.departmentId] }),
    uniqueIndex("invitation_departments_default_unique")
      .on(table.invitationId)
      .where(sql`${table.isDefault} = true`),
    foreignKey({
      columns: [table.organizationId, table.invitationId],
      foreignColumns: [invitations.organizationId, invitations.id],
      name: "invitation_departments_invitation_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: "invitation_departments_department_tenant_fk",
    }),
  ],
);
