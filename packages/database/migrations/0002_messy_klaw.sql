CREATE TYPE "public"."approver_assignment_type" AS ENUM('MEMBERSHIP', 'ROLE', 'DEPARTMENT_ROLE', 'REQUESTER_MANAGER', 'FORM_FIELD_USER');--> statement-breakpoint
CREATE TYPE "public"."configuration_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."duration_unit" AS ENUM('BUSINESS_HOURS', 'BUSINESS_DAYS');--> statement-breakpoint
CREATE TYPE "public"."escalation_action" AS ENUM('NOTIFY', 'RETURN_TO_INITIATOR');--> statement-breakpoint
CREATE TYPE "public"."field_condition_effect" AS ENUM('SHOW', 'HIDE', 'REQUIRE');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'MONEY', 'DATE', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT', 'MEMBER_SELECTOR');--> statement-breakpoint
CREATE TYPE "public"."rule_offset_anchor" AS ENUM('ACTIVATION', 'DUE_TIME');--> statement-breakpoint
CREATE TYPE "public"."stage_completion_policy" AS ENUM('ANY', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."workflow_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "business_calendar_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_calendar_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"name" text NOT NULL,
	"is_working_day_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_calendar_work_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"business_calendar_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"local_start_time" time NOT NULL,
	"local_end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_calendar_work_periods_weekday_range" CHECK ("business_calendar_work_periods"."weekday" between 1 and 7),
	CONSTRAINT "business_calendar_work_periods_time_order" CHECK ("business_calendar_work_periods"."local_start_time" < "business_calendar_work_periods"."local_end_time")
);
--> statement-breakpoint
CREATE TABLE "business_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "configuration_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_calendars_revision_positive" CHECK ("business_calendars"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" "configuration_status" DEFAULT 'ACTIVE' NOT NULL,
	"business_calendar_id" uuid NOT NULL,
	"number_format" text NOT NULL,
	"sequence_padding" integer DEFAULT 6 NOT NULL,
	"approved_pdf_retention_years" integer DEFAULT 7 NOT NULL,
	"approved_pdf_field_policy" jsonb DEFAULT '{"includeAllSubmittedFields":true,"excludedFieldIds":[]}'::jsonb NOT NULL,
	"automatic_approval_enabled" boolean DEFAULT false NOT NULL,
	"automatic_approval_duration" integer,
	"automatic_approval_duration_unit" "duration_unit",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_types_sequence_padding_range" CHECK ("document_types"."sequence_padding" between 1 and 12),
	CONSTRAINT "document_types_retention_years_range" CHECK ("document_types"."approved_pdf_retention_years" between 1 and 25),
	CONSTRAINT "document_types_automatic_approval_shape" CHECK (("document_types"."automatic_approval_enabled" = false and "document_types"."automatic_approval_duration" is null and "document_types"."automatic_approval_duration_unit" is null) or ("document_types"."automatic_approval_enabled" = true and "document_types"."automatic_approval_duration" > 0 and "document_types"."automatic_approval_duration_unit" is not null))
);
--> statement-breakpoint
CREATE TABLE "field_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"target_form_field_id" uuid NOT NULL,
	"effect" "field_condition_effect" NOT NULL,
	"condition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_field_id" uuid NOT NULL,
	"stable_value" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_options_position_positive" CHECK ("field_options"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"form_section_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"type" "form_field_type" NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_fields_position_positive" CHECK ("form_fields"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "form_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_sections_position_positive" CHECK ("form_sections"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "stage_approvers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"assignment_type" "approver_assignment_type" NOT NULL,
	"membership_id" uuid,
	"role_id" uuid,
	"department_id" uuid,
	"form_field_id" uuid,
	"invitation_id" uuid,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_approvers_display_order_positive" CHECK ("stage_approvers"."display_order" > 0),
	CONSTRAINT "stage_approvers_assignment_shape" CHECK (("stage_approvers"."assignment_type" = 'MEMBERSHIP' and num_nonnulls("stage_approvers"."membership_id", "stage_approvers"."invitation_id") = 1 and "stage_approvers"."role_id" is null and "stage_approvers"."department_id" is null and "stage_approvers"."form_field_id" is null) or ("stage_approvers"."assignment_type" = 'ROLE' and "stage_approvers"."role_id" is not null and "stage_approvers"."membership_id" is null and "stage_approvers"."invitation_id" is null and "stage_approvers"."department_id" is null and "stage_approvers"."form_field_id" is null) or ("stage_approvers"."assignment_type" = 'DEPARTMENT_ROLE' and "stage_approvers"."department_id" is not null and "stage_approvers"."role_id" is not null and "stage_approvers"."membership_id" is null and "stage_approvers"."invitation_id" is null and "stage_approvers"."form_field_id" is null) or ("stage_approvers"."assignment_type" = 'REQUESTER_MANAGER' and num_nonnulls("stage_approvers"."membership_id", "stage_approvers"."invitation_id", "stage_approvers"."role_id", "stage_approvers"."department_id", "stage_approvers"."form_field_id") = 0) or ("stage_approvers"."assignment_type" = 'FORM_FIELD_USER' and "stage_approvers"."form_field_id" is not null and "stage_approvers"."membership_id" is null and "stage_approvers"."invitation_id" is null and "stage_approvers"."role_id" is null and "stage_approvers"."department_id" is null))
);
--> statement-breakpoint
CREATE TABLE "stage_escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"offset_value" integer NOT NULL,
	"offset_unit" "duration_unit" NOT NULL,
	"offset_anchor" "rule_offset_anchor" NOT NULL,
	"action" "escalation_action" NOT NULL,
	"recipient_policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_escalation_rules_sequence_positive" CHECK ("stage_escalation_rules"."sequence" > 0),
	CONSTRAINT "stage_escalation_rules_offset_positive" CHECK ("stage_escalation_rules"."offset_value" > 0),
	CONSTRAINT "stage_escalation_rules_recipient_shape" CHECK (("stage_escalation_rules"."action" = 'NOTIFY' and "stage_escalation_rules"."recipient_policy" is not null) or ("stage_escalation_rules"."action" = 'RETURN_TO_INITIATOR' and "stage_escalation_rules"."recipient_policy" is null))
);
--> statement-breakpoint
CREATE TABLE "stage_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_stage_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"offset_value" integer NOT NULL,
	"offset_unit" "duration_unit" NOT NULL,
	"offset_anchor" "rule_offset_anchor" NOT NULL,
	"recipient_policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stage_reminder_rules_sequence_positive" CHECK ("stage_reminder_rules"."sequence" > 0),
	CONSTRAINT "stage_reminder_rules_offset_positive" CHECK ("stage_reminder_rules"."offset_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"position" integer NOT NULL,
	"completion_policy" "stage_completion_policy" NOT NULL,
	"due_duration" integer,
	"due_duration_unit" "duration_unit",
	"business_calendar_id" uuid,
	"activation_condition" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_stages_position_positive" CHECK ("workflow_stages"."position" > 0),
	CONSTRAINT "workflow_stages_due_duration_shape" CHECK (("workflow_stages"."due_duration" is null and "workflow_stages"."due_duration_unit" is null) or ("workflow_stages"."due_duration" > 0 and "workflow_stages"."due_duration_unit" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "workflow_version_status" DEFAULT 'DRAFT' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"allow_no_stage_automatic_approval" boolean DEFAULT false NOT NULL,
	"automatic_approval_enabled" boolean DEFAULT false NOT NULL,
	"automatic_approval_duration" integer,
	"automatic_approval_duration_unit" "duration_unit",
	"business_calendar_id" uuid NOT NULL,
	"approved_pdf_field_policy" jsonb NOT NULL,
	"allow_requester_self_approval" boolean DEFAULT false NOT NULL,
	"published_by_membership_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_version_positive" CHECK ("workflow_versions"."version_number" > 0),
	CONSTRAINT "workflow_versions_revision_positive" CHECK ("workflow_versions"."revision" > 0),
	CONSTRAINT "workflow_versions_publication_metadata" CHECK (("workflow_versions"."status" = 'PUBLISHED' and "workflow_versions"."published_by_membership_id" is not null and "workflow_versions"."published_at" is not null) or ("workflow_versions"."status" <> 'PUBLISHED' and "workflow_versions"."published_by_membership_id" is null and "workflow_versions"."published_at" is null)),
	CONSTRAINT "workflow_versions_automatic_approval_shape" CHECK (("workflow_versions"."automatic_approval_enabled" = false and "workflow_versions"."automatic_approval_duration" is null and "workflow_versions"."automatic_approval_duration_unit" is null) or ("workflow_versions"."automatic_approval_enabled" = true and "workflow_versions"."automatic_approval_duration" > 0 and "workflow_versions"."automatic_approval_duration_unit" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "workflow_status" DEFAULT 'ACTIVE' NOT NULL,
	"current_published_version_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendars_organization_id_unique" ON "business_calendars" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_organization_id_unique" ON "document_types" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_organization_id_unique" ON "form_fields" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_sections_organization_id_unique" ON "form_sections" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_organization_id_unique" ON "workflow_stages" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_organization_id_unique" ON "workflow_versions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_organization_id_unique" ON "workflows" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "business_calendar_holidays" ADD CONSTRAINT "business_calendar_holidays_calendar_tenant_fk" FOREIGN KEY ("organization_id","business_calendar_id") REFERENCES "public"."business_calendars"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendar_work_periods" ADD CONSTRAINT "business_calendar_work_periods_calendar_tenant_fk" FOREIGN KEY ("organization_id","business_calendar_id") REFERENCES "public"."business_calendars"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_calendar_tenant_fk" FOREIGN KEY ("organization_id","business_calendar_id") REFERENCES "public"."business_calendars"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_conditions" ADD CONSTRAINT "field_conditions_version_tenant_fk" FOREIGN KEY ("organization_id","workflow_version_id") REFERENCES "public"."workflow_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_conditions" ADD CONSTRAINT "field_conditions_target_tenant_fk" FOREIGN KEY ("organization_id","target_form_field_id") REFERENCES "public"."form_fields"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_options" ADD CONSTRAINT "field_options_field_tenant_fk" FOREIGN KEY ("organization_id","form_field_id") REFERENCES "public"."form_fields"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_version_tenant_fk" FOREIGN KEY ("organization_id","workflow_version_id") REFERENCES "public"."workflow_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_section_tenant_fk" FOREIGN KEY ("organization_id","form_section_id") REFERENCES "public"."form_sections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_version_tenant_fk" FOREIGN KEY ("organization_id","workflow_version_id") REFERENCES "public"."workflow_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_stage_tenant_fk" FOREIGN KEY ("organization_id","workflow_stage_id") REFERENCES "public"."workflow_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_membership_tenant_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_role_tenant_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_department_tenant_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_form_field_tenant_fk" FOREIGN KEY ("organization_id","form_field_id") REFERENCES "public"."form_fields"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_approvers" ADD CONSTRAINT "stage_approvers_invitation_tenant_fk" FOREIGN KEY ("organization_id","invitation_id") REFERENCES "public"."invitations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_escalation_rules" ADD CONSTRAINT "stage_escalation_rules_stage_tenant_fk" FOREIGN KEY ("organization_id","workflow_stage_id") REFERENCES "public"."workflow_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_reminder_rules" ADD CONSTRAINT "stage_reminder_rules_stage_tenant_fk" FOREIGN KEY ("organization_id","workflow_stage_id") REFERENCES "public"."workflow_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_version_tenant_fk" FOREIGN KEY ("organization_id","workflow_version_id") REFERENCES "public"."workflow_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_calendar_tenant_fk" FOREIGN KEY ("organization_id","business_calendar_id") REFERENCES "public"."business_calendars"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_tenant_fk" FOREIGN KEY ("organization_id","workflow_id") REFERENCES "public"."workflows"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_calendar_tenant_fk" FOREIGN KEY ("organization_id","business_calendar_id") REFERENCES "public"."business_calendars"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_publisher_tenant_fk" FOREIGN KEY ("organization_id","published_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_current_published_version_id_workflow_versions_id_fk" FOREIGN KEY ("current_published_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_document_type_tenant_fk" FOREIGN KEY ("organization_id","document_type_id") REFERENCES "public"."document_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_creator_tenant_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendar_holidays_date_unique" ON "business_calendar_holidays" USING btree ("business_calendar_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendar_work_periods_unique" ON "business_calendar_work_periods" USING btree ("business_calendar_id","weekday","local_start_time","local_end_time");--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendars_organization_name_unique" ON "business_calendars" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "business_calendars_default_unique" ON "business_calendars" USING btree ("organization_id") WHERE "business_calendars"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_organization_name_unique" ON "document_types" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "document_types_organization_code_unique" ON "document_types" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "field_options_field_value_unique" ON "field_options" USING btree ("form_field_id","stable_value");--> statement-breakpoint
CREATE UNIQUE INDEX "field_options_field_position_unique" ON "field_options" USING btree ("form_field_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_version_stable_key_unique" ON "form_fields" USING btree ("workflow_version_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_fields_section_position_unique" ON "form_fields" USING btree ("form_section_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "form_sections_version_stable_key_unique" ON "form_sections" USING btree ("workflow_version_id","stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "form_sections_version_position_unique" ON "form_sections" USING btree ("workflow_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_approvers_stage_order_unique" ON "stage_approvers" USING btree ("workflow_stage_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_escalation_rules_stage_sequence_unique" ON "stage_escalation_rules" USING btree ("workflow_stage_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "stage_reminder_rules_stage_sequence_unique" ON "stage_reminder_rules" USING btree ("workflow_stage_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stages_version_position_unique" ON "workflow_stages" USING btree ("workflow_version_id","position");--> statement-breakpoint
CREATE INDEX "workflow_stages_tenant_version_position_idx" ON "workflow_stages" USING btree ("organization_id","workflow_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_organization_workflow_number_unique" ON "workflow_versions" USING btree ("organization_id","workflow_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_one_draft_unique" ON "workflow_versions" USING btree ("workflow_id") WHERE "workflow_versions"."status" = 'DRAFT';--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_organization_document_type_unique" ON "workflows" USING btree ("organization_id","document_type_id");--> statement-breakpoint
