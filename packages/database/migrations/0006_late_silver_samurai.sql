CREATE TYPE "public"."artifact_grant_purpose" AS ENUM('VIEW', 'PRINT', 'DOWNLOAD');--> statement-breakpoint
CREATE TYPE "public"."artifact_status" AS ENUM('PENDING', 'GENERATING', 'READY', 'RETRY_SCHEDULED', 'PERMANENTLY_FAILED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."delivery_mode" AS ENUM('ATTACHMENT', 'LINK_ONLY');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SENDING', 'ACCEPTED', 'RECONCILING', 'RETRY_SCHEDULED', 'PERMANENTLY_FAILED');--> statement-breakpoint
CREATE TABLE "approved_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"approval_round_id" uuid NOT NULL,
	"status" "artifact_status" DEFAULT 'PENDING' NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text,
	"size_bytes" bigint,
	"renderer_version" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"ready_at" timestamp with time zone,
	"retention_until" timestamp with time zone NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_artifacts_attempts_range" CHECK ("approved_artifacts"."attempts" between 0 and 5),
	CONSTRAINT "approved_artifacts_ready_shape" CHECK (("approved_artifacts"."status" = 'READY' and "approved_artifacts"."sha256" is not null and "approved_artifacts"."size_bytes" > 0 and "approved_artifacts"."ready_at" is not null) or ("approved_artifacts"."status" <> 'READY'))
);
--> statement-breakpoint
CREATE TABLE "artifact_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"audience_membership_id" uuid NOT NULL,
	"purpose" "artifact_grant_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"recipient_membership_id" uuid,
	"recipient_email" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"mode" "delivery_mode" NOT NULL,
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_deliveries_attempts_range" CHECK ("artifact_deliveries"."attempts" between 0 and 8)
);
--> statement-breakpoint
ALTER TABLE "approved_artifacts" ADD CONSTRAINT "approved_artifacts_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_artifacts" ADD CONSTRAINT "approved_artifacts_round_tenant_fk" FOREIGN KEY ("organization_id","approval_round_id") REFERENCES "public"."approval_rounds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approved_artifacts_organization_id_unique" ON "approved_artifacts" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "artifact_access_grants" ADD CONSTRAINT "artifact_access_grants_artifact_tenant_fk" FOREIGN KEY ("organization_id","artifact_id") REFERENCES "public"."approved_artifacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_access_grants" ADD CONSTRAINT "artifact_access_grants_audience_tenant_fk" FOREIGN KEY ("organization_id","audience_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deliveries" ADD CONSTRAINT "artifact_deliveries_artifact_tenant_fk" FOREIGN KEY ("organization_id","artifact_id") REFERENCES "public"."approved_artifacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_deliveries" ADD CONSTRAINT "artifact_deliveries_recipient_tenant_fk" FOREIGN KEY ("organization_id","recipient_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approved_artifacts_round_unique" ON "approved_artifacts" USING btree ("organization_id","approval_round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approved_artifacts_object_key_unique" ON "approved_artifacts" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "approved_artifacts_work_idx" ON "approved_artifacts" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_access_grants_token_unique" ON "artifact_access_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "artifact_access_grants_expiry_idx" ON "artifact_access_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_deliveries_logical_unique" ON "artifact_deliveries" USING btree ("artifact_id","recipient_email","recipient_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_deliveries_provider_key_unique" ON "artifact_deliveries" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE INDEX "artifact_deliveries_work_idx" ON "artifact_deliveries" USING btree ("status","next_attempt_at","lease_expires_at");
