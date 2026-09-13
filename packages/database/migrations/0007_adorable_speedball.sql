CREATE TYPE "public"."scheduled_action_kind" AS ENUM('REMINDER', 'ESCALATION_NOTIFY', 'ESCALATION_RETURN', 'AUTOMATIC_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."scheduled_action_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "scheduled_stage_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"runtime_stage_id" uuid NOT NULL,
	"source_rule_id" uuid,
	"deduplication_key" text NOT NULL,
	"kind" "scheduled_action_kind" NOT NULL,
	"recipient_policy" jsonb,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "scheduled_action_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_stage_actions_attempts_nonnegative" CHECK ("scheduled_stage_actions"."attempts" >= 0),
	CONSTRAINT "scheduled_stage_actions_lease_shape" CHECK (("scheduled_stage_actions"."status" = 'PROCESSING' and "scheduled_stage_actions"."lease_owner" is not null and "scheduled_stage_actions"."lease_expires_at" is not null) or ("scheduled_stage_actions"."status" <> 'PROCESSING'))
);
--> statement-breakpoint
ALTER TABLE "runtime_stages" ADD COLUMN "scheduling_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_stage_actions" ADD CONSTRAINT "scheduled_stage_actions_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_stage_actions" ADD CONSTRAINT "scheduled_stage_actions_stage_tenant_fk" FOREIGN KEY ("organization_id","runtime_stage_id") REFERENCES "public"."runtime_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_stage_actions_stage_dedup_unique" ON "scheduled_stage_actions" USING btree ("runtime_stage_id","deduplication_key");--> statement-breakpoint
CREATE INDEX "scheduled_stage_actions_due_idx" ON "scheduled_stage_actions" USING btree ("status","scheduled_for");