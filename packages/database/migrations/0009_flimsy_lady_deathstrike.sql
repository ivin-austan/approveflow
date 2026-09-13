CREATE TABLE "document_type_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_type_recipients" ADD CONSTRAINT "document_type_recipients_document_type_tenant_fk" FOREIGN KEY ("organization_id","document_type_id") REFERENCES "public"."document_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_recipients" ADD CONSTRAINT "document_type_recipients_membership_tenant_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_type_recipients_unique" ON "document_type_recipients" USING btree ("document_type_id","membership_id");