ALTER TABLE "requests" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_revision_positive" CHECK ("requests"."revision" > 0);