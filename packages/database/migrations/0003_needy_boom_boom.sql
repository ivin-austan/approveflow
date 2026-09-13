CREATE TYPE "public"."approval_round_status" AS ENUM('ACTIVE', 'COMPLETED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."approval_task_status" AS ENUM('PENDING', 'ACTIVE', 'APPROVED', 'REJECTED', 'RETURNED', 'SKIPPED', 'REASSIGNED');--> statement-breakpoint
CREATE TYPE "public"."idempotency_status" AS ENUM('PROCESSING', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."runtime_stage_status" AS ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "approval_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"status" "approval_round_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "approval_rounds_number_positive" CHECK ("approval_rounds"."round_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"runtime_stage_id" uuid NOT NULL,
	"assigned_membership_id" uuid NOT NULL,
	"assignee_name" text NOT NULL,
	"assignee_email" text NOT NULL,
	"status" "approval_task_status" DEFAULT 'PENDING' NOT NULL,
	"activated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid,
	"actor_membership_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_membership_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'PROCESSING' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_response_shape" CHECK (("idempotency_records"."status" = 'PROCESSING' and "idempotency_records"."response_status" is null and "idempotency_records"."response_body" is null) or ("idempotency_records"."status" = 'COMPLETED' and "idempotency_records"."response_status" is not null and "idempotency_records"."response_body" is not null))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'PENDING' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_attempts_nonnegative" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "request_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"form_field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_number_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"allocated_value" bigint NOT NULL,
	"formatted_number" text NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_number_allocations_value_positive" CHECK ("request_number_allocations"."allocated_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_number_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"calendar_year" integer NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_number_sequences_year_range" CHECK ("request_number_sequences"."calendar_year" between 2000 and 9999),
	CONSTRAINT "request_number_sequences_next_positive" CHECK ("request_number_sequences"."next_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"requester_membership_id" uuid NOT NULL,
	"originating_department_id" uuid,
	"request_number" text,
	"title" text NOT NULL,
	"status" "request_status" DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_submission_shape" CHECK (("requests"."status" = 'DRAFT' and "requests"."request_number" is null and "requests"."submitted_at" is null) or ("requests"."status" <> 'DRAFT' and "requests"."request_number" is not null and "requests"."submitted_at" is not null and "requests"."originating_department_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "runtime_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"approval_round_id" uuid NOT NULL,
	"source_workflow_stage_id" uuid NOT NULL,
	"level_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"completion_policy" "stage_completion_policy" NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"status" "runtime_stage_status" DEFAULT 'PENDING' NOT NULL,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_stages_level_positive" CHECK ("runtime_stages"."level_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rounds_organization_id_unique" ON "approval_rounds" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_sequences_organization_id_unique" ON "request_number_sequences" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_organization_id_unique" ON "requests" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_stages_organization_id_unique" ON "runtime_stages" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "approval_rounds" ADD CONSTRAINT "approval_rounds_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_stage_tenant_fk" FOREIGN KEY ("organization_id","runtime_stage_id") REFERENCES "public"."runtime_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_assignee_tenant_fk" FOREIGN KEY ("organization_id","assigned_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_tenant_fk" FOREIGN KEY ("organization_id","actor_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_answers" ADD CONSTRAINT "request_answers_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_answers" ADD CONSTRAINT "request_answers_field_tenant_fk" FOREIGN KEY ("organization_id","form_field_id") REFERENCES "public"."form_fields"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_number_allocations" ADD CONSTRAINT "request_number_allocations_sequence_tenant_fk" FOREIGN KEY ("organization_id","sequence_id") REFERENCES "public"."request_number_sequences"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_number_allocations" ADD CONSTRAINT "request_number_allocations_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_number_sequences" ADD CONSTRAINT "request_number_sequences_document_type_tenant_fk" FOREIGN KEY ("organization_id","document_type_id") REFERENCES "public"."document_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_number_sequences" ADD CONSTRAINT "request_number_sequences_department_tenant_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_workflow_tenant_fk" FOREIGN KEY ("organization_id","workflow_id") REFERENCES "public"."workflows"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_workflow_version_tenant_fk" FOREIGN KEY ("organization_id","workflow_version_id") REFERENCES "public"."workflow_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_document_type_tenant_fk" FOREIGN KEY ("organization_id","document_type_id") REFERENCES "public"."document_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_tenant_fk" FOREIGN KEY ("organization_id","requester_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_department_tenant_fk" FOREIGN KEY ("organization_id","originating_department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_stages" ADD CONSTRAINT "runtime_stages_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_stages" ADD CONSTRAINT "runtime_stages_round_tenant_fk" FOREIGN KEY ("organization_id","approval_round_id") REFERENCES "public"."approval_rounds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_stages" ADD CONSTRAINT "runtime_stages_source_tenant_fk" FOREIGN KEY ("organization_id","source_workflow_stage_id") REFERENCES "public"."workflow_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rounds_request_number_unique" ON "approval_rounds" USING btree ("request_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_rounds_one_active_unique" ON "approval_rounds" USING btree ("request_id") WHERE "approval_rounds"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "approval_tasks_stage_membership_unique" ON "approval_tasks" USING btree ("runtime_stage_id","assigned_membership_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_assignee_status_idx" ON "approval_tasks" USING btree ("organization_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "audit_events_request_time_idx" ON "audit_events" USING btree ("organization_id","request_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_scope_key_unique" ON "idempotency_records" USING btree ("organization_id","actor_membership_id","operation","key");--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_answers_request_field_unique" ON "request_answers" USING btree ("request_id","form_field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_allocations_request_unique" ON "request_number_allocations" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_allocations_sequence_value_unique" ON "request_number_allocations" USING btree ("sequence_id","allocated_value");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_allocations_organization_number_unique" ON "request_number_allocations" USING btree ("organization_id","formatted_number");--> statement-breakpoint
CREATE UNIQUE INDEX "request_number_sequences_scope_unique" ON "request_number_sequences" USING btree ("organization_id","document_type_id","department_id","calendar_year");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_organization_number_unique" ON "requests" USING btree ("organization_id","request_number") WHERE "requests"."request_number" is not null;--> statement-breakpoint
CREATE INDEX "requests_requester_status_idx" ON "requests" USING btree ("organization_id","requester_membership_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_stages_round_level_unique" ON "runtime_stages" USING btree ("approval_round_id","level_number");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_stages_round_source_unique" ON "runtime_stages" USING btree ("approval_round_id","source_workflow_stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_stages_round_final_unique" ON "runtime_stages" USING btree ("approval_round_id") WHERE "runtime_stages"."is_final" = true;--> statement-breakpoint
CREATE INDEX "runtime_stages_request_status_idx" ON "runtime_stages" USING btree ("organization_id","request_id","status");
