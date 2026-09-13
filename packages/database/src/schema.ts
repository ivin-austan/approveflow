import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
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
export const configurationStatus = pgEnum("configuration_status", [
  "ACTIVE",
  "ARCHIVED",
]);
export const workflowStatus = pgEnum("workflow_status", ["ACTIVE", "ARCHIVED"]);
export const workflowVersionStatus = pgEnum("workflow_version_status", [
  "DRAFT",
  "PUBLISHED",
  "RETIRED",
]);
export const durationUnit = pgEnum("duration_unit", [
  "BUSINESS_HOURS",
  "BUSINESS_DAYS",
]);
export const formFieldType = pgEnum("form_field_type", [
  "SHORT_TEXT",
  "LONG_TEXT",
  "NUMBER",
  "MONEY",
  "DATE",
  "BOOLEAN",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "MEMBER_SELECTOR",
]);
export const fieldConditionEffect = pgEnum("field_condition_effect", [
  "SHOW",
  "HIDE",
  "REQUIRE",
]);
export const stageCompletionPolicy = pgEnum("stage_completion_policy", [
  "ANY",
  "ALL",
]);
export const approverAssignmentType = pgEnum("approver_assignment_type", [
  "MEMBERSHIP",
  "ROLE",
  "DEPARTMENT_ROLE",
  "REQUESTER_MANAGER",
  "FORM_FIELD_USER",
]);
export const ruleOffsetAnchor = pgEnum("rule_offset_anchor", [
  "ACTIVATION",
  "DUE_TIME",
]);
export const escalationAction = pgEnum("escalation_action", [
  "NOTIFY",
  "RETURN_TO_INITIATOR",
]);
export const requestStatus = pgEnum("request_status", [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "CANCELLED",
]);
export const approvalRoundStatus = pgEnum("approval_round_status", [
  "ACTIVE",
  "COMPLETED",
  "SUPERSEDED",
]);
export const runtimeStageStatus = pgEnum("runtime_stage_status", [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
  "SKIPPED",
]);
export const approvalTaskStatus = pgEnum("approval_task_status", [
  "PENDING",
  "ACTIVE",
  "APPROVED",
  "REJECTED",
  "RETURNED",
  "SKIPPED",
  "REASSIGNED",
]);
export const idempotencyStatus = pgEnum("idempotency_status", [
  "PROCESSING",
  "COMPLETED",
]);
export const outboxStatus = pgEnum("outbox_status", [
  "PENDING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
]);
export const scheduledActionKind = pgEnum("scheduled_action_kind", [
  "REMINDER",
  "ESCALATION_NOTIFY",
  "ESCALATION_RETURN",
  "AUTOMATIC_APPROVAL",
]);
export const scheduledActionStatus = pgEnum("scheduled_action_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);
export const artifactStatus = pgEnum("artifact_status", [
  "PENDING",
  "GENERATING",
  "READY",
  "RETRY_SCHEDULED",
  "PERMANENTLY_FAILED",
  "DELETING",
  "DELETION_RETRY",
  "DELETION_FAILED",
  "DELETED",
]);
export const deliveryStatus = pgEnum("delivery_status", [
  "PENDING",
  "SENDING",
  "ACCEPTED",
  "RECONCILING",
  "RETRY_SCHEDULED",
  "PERMANENTLY_FAILED",
]);
export const deliveryMode = pgEnum("delivery_mode", [
  "ATTACHMENT",
  "LINK_ONLY",
]);
export const artifactGrantPurpose = pgEnum("artifact_grant_purpose", [
  "VIEW",
  "PRINT",
  "DOWNLOAD",
]);
export const notificationDeliveryStatus = pgEnum(
  "notification_delivery_status",
  [
    "PENDING",
    "SENDING",
    "ACCEPTED",
    "RECONCILING",
    "RETRY_SCHEDULED",
    "PERMANENTLY_FAILED",
  ],
);

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

export const businessCalendars = pgTable(
  "business_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    revision: integer("revision").notNull().default(1),
    isDefault: boolean("is_default").notNull().default(false),
    status: configurationStatus("status").notNull().default("ACTIVE"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("business_calendars_organization_name_unique").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("business_calendars_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("business_calendars_default_unique")
      .on(table.organizationId)
      .where(sql`${table.isDefault} = true`),
    check("business_calendars_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const businessCalendarWorkPeriods = pgTable(
  "business_calendar_work_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    businessCalendarId: uuid("business_calendar_id").notNull(),
    weekday: integer("weekday").notNull(),
    localStartTime: time("local_start_time").notNull(),
    localEndTime: time("local_end_time").notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.businessCalendarId],
      foreignColumns: [businessCalendars.organizationId, businessCalendars.id],
      name: "business_calendar_work_periods_calendar_tenant_fk",
    }),
    uniqueIndex("business_calendar_work_periods_unique").on(
      table.businessCalendarId,
      table.weekday,
      table.localStartTime,
      table.localEndTime,
    ),
    check(
      "business_calendar_work_periods_weekday_range",
      sql`${table.weekday} between 1 and 7`,
    ),
    check(
      "business_calendar_work_periods_time_order",
      sql`${table.localStartTime} < ${table.localEndTime}`,
    ),
  ],
);

export const businessCalendarHolidays = pgTable(
  "business_calendar_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    businessCalendarId: uuid("business_calendar_id").notNull(),
    localDate: date("local_date").notNull(),
    name: text("name").notNull(),
    isWorkingDayOverride: boolean("is_working_day_override")
      .notNull()
      .default(false),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.businessCalendarId],
      foreignColumns: [businessCalendars.organizationId, businessCalendars.id],
      name: "business_calendar_holidays_calendar_tenant_fk",
    }),
    uniqueIndex("business_calendar_holidays_date_unique").on(
      table.businessCalendarId,
      table.localDate,
    ),
  ],
);

export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: configurationStatus("status").notNull().default("ACTIVE"),
    businessCalendarId: uuid("business_calendar_id").notNull(),
    numberFormat: text("number_format").notNull(),
    sequencePadding: integer("sequence_padding").notNull().default(6),
    approvedPdfRetentionYears: integer("approved_pdf_retention_years")
      .notNull()
      .default(7),
    approvedPdfFieldPolicy: jsonb("approved_pdf_field_policy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ includeAllSubmittedFields: true, excludedFieldIds: [] }),
    automaticApprovalEnabled: boolean("automatic_approval_enabled")
      .notNull()
      .default(false),
    automaticApprovalDuration: integer("automatic_approval_duration"),
    automaticApprovalDurationUnit: durationUnit(
      "automatic_approval_duration_unit",
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("document_types_organization_name_unique").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("document_types_organization_code_unique").on(
      table.organizationId,
      table.code,
    ),
    uniqueIndex("document_types_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.businessCalendarId],
      foreignColumns: [businessCalendars.organizationId, businessCalendars.id],
      name: "document_types_calendar_tenant_fk",
    }),
    check(
      "document_types_sequence_padding_range",
      sql`${table.sequencePadding} between 1 and 12`,
    ),
    check(
      "document_types_retention_years_range",
      sql`${table.approvedPdfRetentionYears} between 1 and 25`,
    ),
    check(
      "document_types_automatic_approval_shape",
      sql`(${table.automaticApprovalEnabled} = false and ${table.automaticApprovalDuration} is null and ${table.automaticApprovalDurationUnit} is null) or (${table.automaticApprovalEnabled} = true and ${table.automaticApprovalDuration} > 0 and ${table.automaticApprovalDurationUnit} is not null)`,
    ),
  ],
);

export const documentTypeRecipients = pgTable(
  "document_type_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    documentTypeId: uuid("document_type_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_type_recipients_unique").on(
      table.documentTypeId,
      table.membershipId,
    ),
    foreignKey({
      columns: [table.organizationId, table.documentTypeId],
      foreignColumns: [documentTypes.organizationId, documentTypes.id],
      name: "document_type_recipients_document_type_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "document_type_recipients_membership_tenant_fk",
    }),
  ],
);

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    documentTypeId: uuid("document_type_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: workflowStatus("status").notNull().default("ACTIVE"),
    currentPublishedVersionId: uuid("current_published_version_id").references(
      (): AnyPgColumn => workflowVersions.id,
    ),
    createdByMembershipId: uuid("created_by_membership_id").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workflows_organization_document_type_unique").on(
      table.organizationId,
      table.documentTypeId,
    ),
    uniqueIndex("workflows_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.documentTypeId],
      foreignColumns: [documentTypes.organizationId, documentTypes.id],
      name: "workflows_document_type_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.createdByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "workflows_creator_tenant_fk",
    }),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: workflowVersionStatus("status").notNull().default("DRAFT"),
    revision: integer("revision").notNull().default(1),
    allowNoStageAutomaticApproval: boolean("allow_no_stage_automatic_approval")
      .notNull()
      .default(false),
    automaticApprovalEnabled: boolean("automatic_approval_enabled")
      .notNull()
      .default(false),
    automaticApprovalDuration: integer("automatic_approval_duration"),
    automaticApprovalDurationUnit: durationUnit(
      "automatic_approval_duration_unit",
    ),
    businessCalendarId: uuid("business_calendar_id").notNull(),
    approvedPdfFieldPolicy: jsonb("approved_pdf_field_policy")
      .$type<Record<string, unknown>>()
      .notNull(),
    allowRequesterSelfApproval: boolean("allow_requester_self_approval")
      .notNull()
      .default(false),
    publishedByMembershipId: uuid("published_by_membership_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workflow_versions_organization_workflow_number_unique").on(
      table.organizationId,
      table.workflowId,
      table.versionNumber,
    ),
    uniqueIndex("workflow_versions_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("workflow_versions_one_draft_unique")
      .on(table.workflowId)
      .where(sql`${table.status} = 'DRAFT'`),
    foreignKey({
      columns: [table.organizationId, table.workflowId],
      foreignColumns: [workflows.organizationId, workflows.id],
      name: "workflow_versions_workflow_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.businessCalendarId],
      foreignColumns: [businessCalendars.organizationId, businessCalendars.id],
      name: "workflow_versions_calendar_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.publishedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "workflow_versions_publisher_tenant_fk",
    }),
    check(
      "workflow_versions_version_positive",
      sql`${table.versionNumber} > 0`,
    ),
    check("workflow_versions_revision_positive", sql`${table.revision} > 0`),
    check(
      "workflow_versions_publication_metadata",
      sql`(${table.status} = 'PUBLISHED' and ${table.publishedByMembershipId} is not null and ${table.publishedAt} is not null) or (${table.status} <> 'PUBLISHED' and ${table.publishedByMembershipId} is null and ${table.publishedAt} is null)`,
    ),
    check(
      "workflow_versions_automatic_approval_shape",
      sql`(${table.automaticApprovalEnabled} = false and ${table.automaticApprovalDuration} is null and ${table.automaticApprovalDurationUnit} is null) or (${table.automaticApprovalEnabled} = true and ${table.automaticApprovalDuration} > 0 and ${table.automaticApprovalDurationUnit} is not null)`,
    ),
  ],
);

export const formSections = pgTable(
  "form_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    stableKey: text("stable_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("form_sections_version_stable_key_unique").on(
      table.workflowVersionId,
      table.stableKey,
    ),
    uniqueIndex("form_sections_version_position_unique").on(
      table.workflowVersionId,
      table.position,
    ),
    uniqueIndex("form_sections_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowVersionId],
      foreignColumns: [workflowVersions.organizationId, workflowVersions.id],
      name: "form_sections_version_tenant_fk",
    }),
    check("form_sections_position_positive", sql`${table.position} > 0`),
  ],
);

export const formFields = pgTable(
  "form_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    formSectionId: uuid("form_section_id").notNull(),
    stableKey: text("stable_key").notNull(),
    type: formFieldType("type").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    isRequired: boolean("is_required").notNull().default(false),
    position: integer("position").notNull(),
    config: jsonb("config")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("form_fields_version_stable_key_unique").on(
      table.workflowVersionId,
      table.stableKey,
    ),
    uniqueIndex("form_fields_section_position_unique").on(
      table.formSectionId,
      table.position,
    ),
    uniqueIndex("form_fields_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowVersionId],
      foreignColumns: [workflowVersions.organizationId, workflowVersions.id],
      name: "form_fields_version_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.formSectionId],
      foreignColumns: [formSections.organizationId, formSections.id],
      name: "form_fields_section_tenant_fk",
    }),
    check("form_fields_position_positive", sql`${table.position} > 0`),
  ],
);

export const fieldOptions = pgTable(
  "field_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    formFieldId: uuid("form_field_id").notNull(),
    stableValue: text("stable_value").notNull(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("field_options_field_value_unique").on(
      table.formFieldId,
      table.stableValue,
    ),
    uniqueIndex("field_options_field_position_unique").on(
      table.formFieldId,
      table.position,
    ),
    foreignKey({
      columns: [table.organizationId, table.formFieldId],
      foreignColumns: [formFields.organizationId, formFields.id],
      name: "field_options_field_tenant_fk",
    }),
    check("field_options_position_positive", sql`${table.position} > 0`),
  ],
);

export const fieldConditions = pgTable(
  "field_conditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    targetFormFieldId: uuid("target_form_field_id").notNull(),
    effect: fieldConditionEffect("effect").notNull(),
    condition: jsonb("condition").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.workflowVersionId],
      foreignColumns: [workflowVersions.organizationId, workflowVersions.id],
      name: "field_conditions_version_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.targetFormFieldId],
      foreignColumns: [formFields.organizationId, formFields.id],
      name: "field_conditions_target_tenant_fk",
    }),
  ],
);

export const workflowStages = pgTable(
  "workflow_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    position: integer("position").notNull(),
    completionPolicy: stageCompletionPolicy("completion_policy").notNull(),
    dueDuration: integer("due_duration"),
    dueDurationUnit: durationUnit("due_duration_unit"),
    businessCalendarId: uuid("business_calendar_id"),
    activationCondition: jsonb("activation_condition").$type<
      Record<string, unknown>
    >(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workflow_stages_version_position_unique").on(
      table.workflowVersionId,
      table.position,
    ),
    uniqueIndex("workflow_stages_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    index("workflow_stages_tenant_version_position_idx").on(
      table.organizationId,
      table.workflowVersionId,
      table.position,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowVersionId],
      foreignColumns: [workflowVersions.organizationId, workflowVersions.id],
      name: "workflow_stages_version_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.businessCalendarId],
      foreignColumns: [businessCalendars.organizationId, businessCalendars.id],
      name: "workflow_stages_calendar_tenant_fk",
    }),
    check("workflow_stages_position_positive", sql`${table.position} > 0`),
    check(
      "workflow_stages_due_duration_shape",
      sql`(${table.dueDuration} is null and ${table.dueDurationUnit} is null) or (${table.dueDuration} > 0 and ${table.dueDurationUnit} is not null)`,
    ),
  ],
);

export const stageApprovers = pgTable(
  "stage_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowStageId: uuid("workflow_stage_id").notNull(),
    assignmentType: approverAssignmentType("assignment_type").notNull(),
    membershipId: uuid("membership_id"),
    roleId: uuid("role_id"),
    departmentId: uuid("department_id"),
    formFieldId: uuid("form_field_id"),
    invitationId: uuid("invitation_id"),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("stage_approvers_stage_order_unique").on(
      table.workflowStageId,
      table.displayOrder,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowStageId],
      foreignColumns: [workflowStages.organizationId, workflowStages.id],
      name: "stage_approvers_stage_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "stage_approvers_membership_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
      name: "stage_approvers_role_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: "stage_approvers_department_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.formFieldId],
      foreignColumns: [formFields.organizationId, formFields.id],
      name: "stage_approvers_form_field_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.invitationId],
      foreignColumns: [invitations.organizationId, invitations.id],
      name: "stage_approvers_invitation_tenant_fk",
    }),
    check(
      "stage_approvers_display_order_positive",
      sql`${table.displayOrder} > 0`,
    ),
    check(
      "stage_approvers_assignment_shape",
      sql`(${table.assignmentType} = 'MEMBERSHIP' and num_nonnulls(${table.membershipId}, ${table.invitationId}) = 1 and ${table.roleId} is null and ${table.departmentId} is null and ${table.formFieldId} is null) or (${table.assignmentType} = 'ROLE' and ${table.roleId} is not null and ${table.membershipId} is null and ${table.invitationId} is null and ${table.departmentId} is null and ${table.formFieldId} is null) or (${table.assignmentType} = 'DEPARTMENT_ROLE' and ${table.departmentId} is not null and ${table.roleId} is not null and ${table.membershipId} is null and ${table.invitationId} is null and ${table.formFieldId} is null) or (${table.assignmentType} = 'REQUESTER_MANAGER' and num_nonnulls(${table.membershipId}, ${table.invitationId}, ${table.roleId}, ${table.departmentId}, ${table.formFieldId}) = 0) or (${table.assignmentType} = 'FORM_FIELD_USER' and ${table.formFieldId} is not null and ${table.membershipId} is null and ${table.invitationId} is null and ${table.roleId} is null and ${table.departmentId} is null)`,
    ),
  ],
);

export const stageReminderRules = pgTable(
  "stage_reminder_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowStageId: uuid("workflow_stage_id").notNull(),
    sequence: integer("sequence").notNull(),
    offsetValue: integer("offset_value").notNull(),
    offsetUnit: durationUnit("offset_unit").notNull(),
    offsetAnchor: ruleOffsetAnchor("offset_anchor").notNull(),
    recipientPolicy: jsonb("recipient_policy")
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stage_reminder_rules_stage_sequence_unique").on(
      table.workflowStageId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowStageId],
      foreignColumns: [workflowStages.organizationId, workflowStages.id],
      name: "stage_reminder_rules_stage_tenant_fk",
    }),
    check("stage_reminder_rules_sequence_positive", sql`${table.sequence} > 0`),
    check(
      "stage_reminder_rules_offset_positive",
      sql`${table.offsetValue} > 0`,
    ),
  ],
);

export const stageEscalationRules = pgTable(
  "stage_escalation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowStageId: uuid("workflow_stage_id").notNull(),
    sequence: integer("sequence").notNull(),
    offsetValue: integer("offset_value").notNull(),
    offsetUnit: durationUnit("offset_unit").notNull(),
    offsetAnchor: ruleOffsetAnchor("offset_anchor").notNull(),
    action: escalationAction("action").notNull(),
    recipientPolicy: jsonb("recipient_policy").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stage_escalation_rules_stage_sequence_unique").on(
      table.workflowStageId,
      table.sequence,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowStageId],
      foreignColumns: [workflowStages.organizationId, workflowStages.id],
      name: "stage_escalation_rules_stage_tenant_fk",
    }),
    check(
      "stage_escalation_rules_sequence_positive",
      sql`${table.sequence} > 0`,
    ),
    check(
      "stage_escalation_rules_offset_positive",
      sql`${table.offsetValue} > 0`,
    ),
    check(
      "stage_escalation_rules_recipient_shape",
      sql`(${table.action} = 'NOTIFY' and ${table.recipientPolicy} is not null) or (${table.action} = 'RETURN_TO_INITIATOR' and ${table.recipientPolicy} is null)`,
    ),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    workflowId: uuid("workflow_id").notNull(),
    workflowVersionId: uuid("workflow_version_id").notNull(),
    documentTypeId: uuid("document_type_id").notNull(),
    requesterMembershipId: uuid("requester_membership_id").notNull(),
    originatingDepartmentId: uuid("originating_department_id"),
    requestNumber: text("request_number"),
    title: text("title").notNull(),
    status: requestStatus("status").notNull().default("DRAFT"),
    revision: integer("revision").notNull().default(1),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("requests_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("requests_organization_number_unique")
      .on(table.organizationId, table.requestNumber)
      .where(sql`${table.requestNumber} is not null`),
    index("requests_requester_status_idx").on(
      table.organizationId,
      table.requesterMembershipId,
      table.status,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.workflowId],
      foreignColumns: [workflows.organizationId, workflows.id],
      name: "requests_workflow_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.workflowVersionId],
      foreignColumns: [workflowVersions.organizationId, workflowVersions.id],
      name: "requests_workflow_version_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.documentTypeId],
      foreignColumns: [documentTypes.organizationId, documentTypes.id],
      name: "requests_document_type_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.requesterMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "requests_requester_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.originatingDepartmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: "requests_department_tenant_fk",
    }),
    check(
      "requests_submission_shape",
      sql`(${table.status} = 'DRAFT' and ${table.requestNumber} is null and ${table.submittedAt} is null) or (${table.status} <> 'DRAFT' and ${table.requestNumber} is not null and ${table.submittedAt} is not null and ${table.originatingDepartmentId} is not null)`,
    ),
    check("requests_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const requestAnswers = pgTable(
  "request_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    formFieldId: uuid("form_field_id").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("request_answers_request_field_unique").on(
      table.requestId,
      table.formFieldId,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "request_answers_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.formFieldId],
      foreignColumns: [formFields.organizationId, formFields.id],
      name: "request_answers_field_tenant_fk",
    }),
  ],
);

export const approvalRounds = pgTable(
  "approval_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    status: approvalRoundStatus("status").notNull().default("ACTIVE"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("approval_rounds_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("approval_rounds_request_number_unique").on(
      table.requestId,
      table.roundNumber,
    ),
    uniqueIndex("approval_rounds_one_active_unique")
      .on(table.requestId)
      .where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "approval_rounds_request_tenant_fk",
    }),
    check("approval_rounds_number_positive", sql`${table.roundNumber} > 0`),
  ],
);

export const runtimeStages = pgTable(
  "runtime_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    approvalRoundId: uuid("approval_round_id").notNull(),
    sourceWorkflowStageId: uuid("source_workflow_stage_id").notNull(),
    levelNumber: integer("level_number").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    completionPolicy: stageCompletionPolicy("completion_policy").notNull(),
    isFinal: boolean("is_final").notNull().default(false),
    status: runtimeStageStatus("status").notNull().default("PENDING"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    schedulingCompletedAt: timestamp("scheduling_completed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("runtime_stages_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("runtime_stages_round_level_unique").on(
      table.approvalRoundId,
      table.levelNumber,
    ),
    uniqueIndex("runtime_stages_round_source_unique").on(
      table.approvalRoundId,
      table.sourceWorkflowStageId,
    ),
    uniqueIndex("runtime_stages_round_final_unique")
      .on(table.approvalRoundId)
      .where(sql`${table.isFinal} = true`),
    index("runtime_stages_request_status_idx").on(
      table.organizationId,
      table.requestId,
      table.status,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "runtime_stages_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.approvalRoundId],
      foreignColumns: [approvalRounds.organizationId, approvalRounds.id],
      name: "runtime_stages_round_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.sourceWorkflowStageId],
      foreignColumns: [workflowStages.organizationId, workflowStages.id],
      name: "runtime_stages_source_tenant_fk",
    }),
    check("runtime_stages_level_positive", sql`${table.levelNumber} > 0`),
  ],
);

export const scheduledStageActions = pgTable(
  "scheduled_stage_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    runtimeStageId: uuid("runtime_stage_id").notNull(),
    sourceRuleId: uuid("source_rule_id"),
    deduplicationKey: text("deduplication_key").notNull(),
    kind: scheduledActionKind("kind").notNull(),
    recipientPolicy: jsonb("recipient_policy").$type<Record<string, unknown>>(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: scheduledActionStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("scheduled_stage_actions_stage_dedup_unique").on(
      table.runtimeStageId,
      table.deduplicationKey,
    ),
    index("scheduled_stage_actions_due_idx").on(
      table.status,
      table.scheduledFor,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "scheduled_stage_actions_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.runtimeStageId],
      foreignColumns: [runtimeStages.organizationId, runtimeStages.id],
      name: "scheduled_stage_actions_stage_tenant_fk",
    }),
    check(
      "scheduled_stage_actions_attempts_nonnegative",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "scheduled_stage_actions_lease_shape",
      sql`(${table.status} = 'PROCESSING' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'PROCESSING')`,
    ),
  ],
);

export const approvalTasks = pgTable(
  "approval_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    runtimeStageId: uuid("runtime_stage_id").notNull(),
    assignedMembershipId: uuid("assigned_membership_id").notNull(),
    assigneeName: text("assignee_name").notNull(),
    assigneeEmail: text("assignee_email").notNull(),
    status: approvalTaskStatus("status").notNull().default("PENDING"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_tasks_stage_membership_unique").on(
      table.runtimeStageId,
      table.assignedMembershipId,
    ),
    index("approval_tasks_assignee_status_idx").on(
      table.organizationId,
      table.assignedMembershipId,
      table.status,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "approval_tasks_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.runtimeStageId],
      foreignColumns: [runtimeStages.organizationId, runtimeStages.id],
      name: "approval_tasks_stage_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.assignedMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "approval_tasks_assignee_tenant_fk",
    }),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    operation: text("operation").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("PROCESSING"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idempotency_records_scope_key_unique").on(
      table.organizationId,
      table.actorMembershipId,
      table.operation,
      table.key,
    ),
    foreignKey({
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "idempotency_records_actor_tenant_fk",
    }),
    check(
      "idempotency_records_response_shape",
      sql`(${table.status} = 'PROCESSING' and ${table.responseStatus} is null and ${table.responseBody} is null) or (${table.status} = 'COMPLETED' and ${table.responseStatus} is not null and ${table.responseBody} is not null)`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id"),
    actorMembershipId: uuid("actor_membership_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_request_time_idx").on(
      table.organizationId,
      table.requestId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "audit_events_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.actorMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "audit_events_actor_tenant_fk",
    }),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").notNull().default("PENDING"),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("outbox_events_dispatch_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    check("outbox_events_attempts_nonnegative", sql`${table.attempts} >= 0`),
  ],
);

export const requestNumberSequences = pgTable(
  "request_number_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    documentTypeId: uuid("document_type_id").notNull(),
    departmentId: uuid("department_id").notNull(),
    calendarYear: integer("calendar_year").notNull(),
    nextValue: bigint("next_value", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("request_number_sequences_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("request_number_sequences_scope_unique").on(
      table.organizationId,
      table.documentTypeId,
      table.departmentId,
      table.calendarYear,
    ),
    foreignKey({
      columns: [table.organizationId, table.documentTypeId],
      foreignColumns: [documentTypes.organizationId, documentTypes.id],
      name: "request_number_sequences_document_type_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.departmentId],
      foreignColumns: [departments.organizationId, departments.id],
      name: "request_number_sequences_department_tenant_fk",
    }),
    check(
      "request_number_sequences_year_range",
      sql`${table.calendarYear} between 2000 and 9999`,
    ),
    check(
      "request_number_sequences_next_positive",
      sql`${table.nextValue} > 0`,
    ),
  ],
);

export const requestNumberAllocations = pgTable(
  "request_number_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    sequenceId: uuid("sequence_id").notNull(),
    requestId: uuid("request_id").notNull(),
    allocatedValue: bigint("allocated_value", { mode: "bigint" }).notNull(),
    formattedNumber: text("formatted_number").notNull(),
    allocatedAt: timestamp("allocated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("request_number_allocations_request_unique").on(
      table.requestId,
    ),
    uniqueIndex("request_number_allocations_sequence_value_unique").on(
      table.sequenceId,
      table.allocatedValue,
    ),
    uniqueIndex("request_number_allocations_organization_number_unique").on(
      table.organizationId,
      table.formattedNumber,
    ),
    foreignKey({
      columns: [table.organizationId, table.sequenceId],
      foreignColumns: [
        requestNumberSequences.organizationId,
        requestNumberSequences.id,
      ],
      name: "request_number_allocations_sequence_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "request_number_allocations_request_tenant_fk",
    }),
    check(
      "request_number_allocations_value_positive",
      sql`${table.allocatedValue} > 0`,
    ),
  ],
);

export const approvedArtifacts = pgTable(
  "approved_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    approvalRoundId: uuid("approval_round_id").notNull(),
    status: artifactStatus("status").notNull().default("PENDING"),
    objectKey: text("object_key").notNull(),
    sha256: text("sha256"),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    rendererVersion: text("renderer_version").notNull(),
    attempts: integer("attempts").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    retentionUntil: timestamp("retention_until", {
      withTimezone: true,
    }).notNull(),
    legalHold: boolean("legal_hold").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletionAttempts: integer("deletion_attempts").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("approved_artifacts_organization_id_unique").on(
      table.organizationId,
      table.id,
    ),
    uniqueIndex("approved_artifacts_round_unique").on(
      table.organizationId,
      table.approvalRoundId,
    ),
    uniqueIndex("approved_artifacts_object_key_unique").on(table.objectKey),
    index("approved_artifacts_work_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "approved_artifacts_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.approvalRoundId],
      foreignColumns: [approvalRounds.organizationId, approvalRounds.id],
      name: "approved_artifacts_round_tenant_fk",
    }),
    check(
      "approved_artifacts_attempts_range",
      sql`${table.attempts} between 0 and 5`,
    ),
    check(
      "approved_artifacts_deletion_attempts_range",
      sql`${table.deletionAttempts} between 0 and 8`,
    ),
    check(
      "approved_artifacts_ready_shape",
      sql`(${table.status} = 'READY' and ${table.sha256} is not null and ${table.sizeBytes} > 0 and ${table.readyAt} is not null) or (${table.status} <> 'READY')`,
    ),
  ],
);

export const artifactDeliveries = pgTable(
  "artifact_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    recipientMembershipId: uuid("recipient_membership_id"),
    recipientEmail: text("recipient_email").notNull(),
    recipientKind: text("recipient_kind").notNull(),
    mode: deliveryMode("mode").notNull(),
    status: deliveryStatus("status").notNull().default("PENDING"),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("artifact_deliveries_logical_unique").on(
      table.artifactId,
      table.recipientEmail,
      table.recipientKind,
    ),
    uniqueIndex("artifact_deliveries_provider_key_unique").on(
      table.providerIdempotencyKey,
    ),
    index("artifact_deliveries_work_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.artifactId],
      foreignColumns: [approvedArtifacts.organizationId, approvedArtifacts.id],
      name: "artifact_deliveries_artifact_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.recipientMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "artifact_deliveries_recipient_tenant_fk",
    }),
    check(
      "artifact_deliveries_attempts_range",
      sql`${table.attempts} between 0 and 8`,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id").notNull(),
    runtimeStageId: uuid("runtime_stage_id"),
    sourceEventId: uuid("source_event_id").notNull(),
    eventType: text("event_type").notNull(),
    recipientMembershipId: uuid("recipient_membership_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: notificationDeliveryStatus("status").notNull().default("PENDING"),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("notification_deliveries_event_recipient_unique").on(
      table.sourceEventId,
      table.recipientMembershipId,
    ),
    uniqueIndex("notification_deliveries_provider_key_unique").on(
      table.providerIdempotencyKey,
    ),
    index("notification_deliveries_work_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    foreignKey({
      columns: [table.organizationId, table.requestId],
      foreignColumns: [requests.organizationId, requests.id],
      name: "notification_deliveries_request_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.runtimeStageId],
      foreignColumns: [runtimeStages.organizationId, runtimeStages.id],
      name: "notification_deliveries_stage_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.recipientMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "notification_deliveries_recipient_tenant_fk",
    }),
    check(
      "notification_deliveries_attempts_range",
      sql`${table.attempts} between 0 and 8`,
    ),
  ],
);

export const artifactAccessGrants = pgTable(
  "artifact_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    artifactId: uuid("artifact_id").notNull(),
    audienceMembershipId: uuid("audience_membership_id").notNull(),
    purpose: artifactGrantPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("artifact_access_grants_token_unique").on(table.tokenHash),
    index("artifact_access_grants_expiry_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.organizationId, table.artifactId],
      foreignColumns: [approvedArtifacts.organizationId, approvedArtifacts.id],
      name: "artifact_access_grants_artifact_tenant_fk",
    }),
    foreignKey({
      columns: [table.organizationId, table.audienceMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: "artifact_access_grants_audience_tenant_fk",
    }),
  ],
);
