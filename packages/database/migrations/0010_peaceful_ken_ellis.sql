ALTER TYPE "public"."artifact_status" ADD VALUE 'DELETING' BEFORE 'DELETED';--> statement-breakpoint
ALTER TYPE "public"."artifact_status" ADD VALUE 'DELETION_RETRY' BEFORE 'DELETED';--> statement-breakpoint
ALTER TYPE "public"."artifact_status" ADD VALUE 'DELETION_FAILED' BEFORE 'DELETED';--> statement-breakpoint
ALTER TABLE "approved_artifacts" ADD COLUMN "deletion_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approved_artifacts" ADD CONSTRAINT "approved_artifacts_deletion_attempts_range" CHECK ("approved_artifacts"."deletion_attempts" between 0 and 8);