CREATE TYPE "public"."notification_delivery_status" AS ENUM('PENDING', 'SENDING', 'ACCEPTED', 'RECONCILING', 'RETRY_SCHEDULED', 'PERMANENTLY_FAILED');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"runtime_stage_id" uuid,
	"source_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "notification_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_attempts_range" CHECK ("notification_deliveries"."attempts" between 0 and 8)
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_request_tenant_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_stage_tenant_fk" FOREIGN KEY ("organization_id","runtime_stage_id") REFERENCES "public"."runtime_stages"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_tenant_fk" FOREIGN KEY ("organization_id","recipient_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_event_recipient_unique" ON "notification_deliveries" USING btree ("source_event_id","recipient_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_provider_key_unique" ON "notification_deliveries" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_work_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at","lease_expires_at");