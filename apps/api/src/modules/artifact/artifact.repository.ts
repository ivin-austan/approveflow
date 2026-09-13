import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvedArtifacts,
  artifactAccessGrants,
  auditEvents,
  formFields,
  requestAnswers,
  requests,
  outboxEvents,
  runtimeStages,
  schema as databaseSchema,
  workflows,
} from "@approveflow/database";
import type { ArtifactRepository } from "./artifact.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;
export class DrizzleArtifactRepository implements ArtifactRepository {
  public constructor(private readonly database: Database) {}
  public claimGeneration(workerId: string, now: Date, leaseUntil: Date) {
    return this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .select()
        .from(approvedArtifacts)
        .where(
          and(
            inArray(approvedArtifacts.status, [
              "PENDING",
              "RETRY_SCHEDULED",
              "GENERATING",
            ]),
            or(
              isNull(approvedArtifacts.nextAttemptAt),
              lte(approvedArtifacts.nextAttemptAt, now),
            ),
            or(
              isNull(approvedArtifacts.leaseExpiresAt),
              lte(approvedArtifacts.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(approvedArtifacts.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!artifact || artifact.attempts >= 5) return null;
      await transaction
        .update(approvedArtifacts)
        .set({
          status: "GENERATING",
          attempts: artifact.attempts + 1,
          leaseOwner: workerId,
          leaseExpiresAt: leaseUntil,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(approvedArtifacts.id, artifact.id));
      const [request] = await transaction
        .select({
          number: requests.requestNumber,
          title: requests.title,
          completedAt: requests.completedAt,
          workflowName: workflows.name,
        })
        .from(requests)
        .innerJoin(
          workflows,
          and(
            eq(workflows.organizationId, requests.organizationId),
            eq(workflows.id, requests.workflowId),
          ),
        )
        .where(
          and(
            eq(requests.organizationId, artifact.organizationId),
            eq(requests.id, artifact.requestId),
          ),
        );
      if (!request?.number || !request.completedAt)
        throw new Error("Approved request data is incomplete");
      const fields = await transaction
        .select({ label: formFields.label, value: requestAnswers.value })
        .from(requestAnswers)
        .innerJoin(
          formFields,
          and(
            eq(formFields.organizationId, requestAnswers.organizationId),
            eq(formFields.id, requestAnswers.formFieldId),
          ),
        )
        .where(
          and(
            eq(requestAnswers.organizationId, artifact.organizationId),
            eq(requestAnswers.requestId, artifact.requestId),
          ),
        )
        .orderBy(asc(formFields.position));
      const events = await transaction
        .select({
          payload: auditEvents.payload,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, artifact.organizationId),
            eq(auditEvents.requestId, artifact.requestId),
            inArray(auditEvents.eventType, [
              "APPROVAL_APPROVE",
              "AUTOMATICALLY_APPROVED",
            ]),
          ),
        )
        .orderBy(asc(auditEvents.occurredAt));
      const stages = await transaction
        .select({ id: runtimeStages.id, name: runtimeStages.name })
        .from(runtimeStages)
        .where(
          and(
            eq(runtimeStages.organizationId, artifact.organizationId),
            eq(runtimeStages.requestId, artifact.requestId),
            eq(runtimeStages.approvalRoundId, artifact.approvalRoundId),
          ),
        );
      const stageNames = new Map(stages.map((stage) => [stage.id, stage.name]));
      return {
        id: artifact.id,
        organizationId: artifact.organizationId,
        requestId: artifact.requestId,
        objectKey: artifact.objectKey,
        attempts: artifact.attempts + 1,
        model: {
          requestNumber: request.number,
          title: request.title,
          workflowName: request.workflowName,
          approvedAt: request.completedAt.toISOString(),
          fields: fields.map((field) => ({
            label: field.label,
            value: displayValue(field.value),
          })),
          decisions: events.map((event) => ({
            stage:
              typeof event.payload.stageId === "string"
                ? (stageNames.get(event.payload.stageId) ?? "Approval")
                : "Automatic approval",
            approver:
              typeof event.payload.approverName === "string"
                ? event.payload.approverName
                : "System",
            decision: "Approved",
            timestamp: event.occurredAt.toISOString(),
            comment:
              typeof event.payload.comment === "string"
                ? event.payload.comment
                : null,
          })),
        },
      };
    });
  }
  public async markReady(
    input: Parameters<ArtifactRepository["markReady"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(approvedArtifacts)
        .set({
          status: "READY",
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          readyAt: input.now,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(approvedArtifacts.id, input.artifactId),
            eq(approvedArtifacts.status, "GENERATING"),
            eq(approvedArtifacts.leaseOwner, input.workerId),
          ),
        )
        .returning({
          id: approvedArtifacts.id,
          organizationId: approvedArtifacts.organizationId,
          requestId: approvedArtifacts.requestId,
        });
      const artifact = rows[0];
      if (!artifact) return false;
      await transaction.insert(auditEvents).values({
        organizationId: artifact.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: null,
        eventType: "APPROVED_PDF_READY",
        payload: {
          artifactId: artifact.id,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes.toString(),
        },
      });
      await transaction.insert(outboxEvents).values({
        organizationId: artifact.organizationId,
        aggregateType: "APPROVED_ARTIFACT",
        aggregateId: artifact.id,
        eventType: "APPROVED_ARTIFACT_READY",
        payload: { artifactId: artifact.id },
      });
      return true;
    });
  }
  public async markGenerationFailure(
    input: Parameters<ArtifactRepository["markGenerationFailure"]>[0],
  ) {
    const rows = await this.database
      .update(approvedArtifacts)
      .set({
        status: input.nextAttemptAt ? "RETRY_SCHEDULED" : "PERMANENTLY_FAILED",
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(approvedArtifacts.id, input.artifactId),
          eq(approvedArtifacts.status, "GENERATING"),
          eq(approvedArtifacts.leaseOwner, input.workerId),
        ),
      )
      .returning({ id: approvedArtifacts.id });
    return rows.length === 1;
  }
  public async createGrant(
    input: Parameters<ArtifactRepository["createGrant"]>[0],
  ) {
    const [artifact] = await this.database
      .select({ id: approvedArtifacts.id })
      .from(approvedArtifacts)
      .where(
        and(
          eq(approvedArtifacts.organizationId, input.organizationId),
          eq(approvedArtifacts.id, input.artifactId),
          eq(approvedArtifacts.status, "READY"),
        ),
      );
    if (!artifact) return false;
    await this.database.insert(artifactAccessGrants).values(input);
    return true;
  }
  public consumeGrant(
    input: Parameters<ArtifactRepository["consumeGrant"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const [grant] = await transaction
        .select()
        .from(artifactAccessGrants)
        .where(
          and(
            eq(artifactAccessGrants.organizationId, input.organizationId),
            eq(artifactAccessGrants.artifactId, input.artifactId),
            eq(
              artifactAccessGrants.audienceMembershipId,
              input.audienceMembershipId,
            ),
            eq(artifactAccessGrants.purpose, input.purpose),
            eq(artifactAccessGrants.tokenHash, input.tokenHash),
            isNull(artifactAccessGrants.consumedAt),
          ),
        )
        .for("update");
      if (!grant || grant.expiresAt <= input.now) return null;
      const [artifact] = await transaction
        .select({
          objectKey: approvedArtifacts.objectKey,
          sha256: approvedArtifacts.sha256,
          requestId: approvedArtifacts.requestId,
        })
        .from(approvedArtifacts)
        .where(
          and(
            eq(approvedArtifacts.organizationId, input.organizationId),
            eq(approvedArtifacts.id, input.artifactId),
            eq(approvedArtifacts.status, "READY"),
          ),
        );
      if (!artifact?.sha256) return null;
      await transaction
        .update(artifactAccessGrants)
        .set({ consumedAt: input.now })
        .where(eq(artifactAccessGrants.id, grant.id));
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: input.audienceMembershipId,
        eventType: `APPROVED_PDF_${input.purpose}`,
        payload: { artifactId: input.artifactId },
      });
      return {
        objectKey: artifact.objectKey,
        sha256: artifact.sha256,
        requestId: artifact.requestId,
      };
    });
  }
  public retryGeneration(
    input: Parameters<ArtifactRepository["retryGeneration"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .update(approvedArtifacts)
        .set({
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: input.now,
          lastErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(approvedArtifacts.organizationId, input.organizationId),
            eq(approvedArtifacts.id, input.artifactId),
            eq(approvedArtifacts.status, "PERMANENTLY_FAILED"),
          ),
        )
        .returning({
          id: approvedArtifacts.id,
          requestId: approvedArtifacts.requestId,
        });
      if (!artifact) return false;
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: input.actorMembershipId,
        eventType: "APPROVED_PDF_RETRY_REQUESTED",
        payload: { artifactId: artifact.id },
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "APPROVED_ARTIFACT",
        aggregateId: artifact.id,
        eventType: "APPROVED_ARTIFACT_GENERATION_REQUESTED",
        payload: { artifactId: artifact.id, requestId: artifact.requestId },
      });
      return true;
    });
  }
  public claimDeletion(workerId: string, now: Date, leaseUntil: Date) {
    return this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .select()
        .from(approvedArtifacts)
        .where(
          and(
            eq(approvedArtifacts.legalHold, false),
            or(
              and(
                eq(approvedArtifacts.status, "READY"),
                lte(approvedArtifacts.retentionUntil, now),
              ),
              and(
                inArray(approvedArtifacts.status, [
                  "DELETION_RETRY",
                  "DELETING",
                ]),
                or(
                  isNull(approvedArtifacts.nextAttemptAt),
                  lte(approvedArtifacts.nextAttemptAt, now),
                ),
                or(
                  isNull(approvedArtifacts.leaseExpiresAt),
                  lte(approvedArtifacts.leaseExpiresAt, now),
                ),
              ),
            ),
          ),
        )
        .orderBy(asc(approvedArtifacts.retentionUntil))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!artifact || artifact.deletionAttempts >= 8) return null;
      await transaction
        .update(approvedArtifacts)
        .set({
          status: "DELETING",
          deletionAttempts: artifact.deletionAttempts + 1,
          leaseOwner: workerId,
          leaseExpiresAt: leaseUntil,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(approvedArtifacts.id, artifact.id));
      return {
        id: artifact.id,
        objectKey: artifact.objectKey,
        attempts: artifact.deletionAttempts + 1,
      };
    });
  }
  public async markDeleted(artifactId: string, workerId: string, now: Date) {
    return this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .update(approvedArtifacts)
        .set({
          status: "DELETED",
          deletedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(approvedArtifacts.id, artifactId),
            eq(approvedArtifacts.status, "DELETING"),
            eq(approvedArtifacts.leaseOwner, workerId),
            eq(approvedArtifacts.legalHold, false),
          ),
        )
        .returning({
          organizationId: approvedArtifacts.organizationId,
          requestId: approvedArtifacts.requestId,
        });
      if (!artifact) return false;
      await transaction.insert(auditEvents).values({
        organizationId: artifact.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: null,
        eventType: "APPROVED_PDF_DELETED",
        payload: { artifactId },
      });
      return true;
    });
  }
  public async markDeletionFailure(
    artifactId: string,
    workerId: string,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ) {
    const rows = await this.database
      .update(approvedArtifacts)
      .set({
        status: retryAt ? "DELETION_RETRY" : "DELETION_FAILED",
        lastErrorCode: errorCode,
        nextAttemptAt: retryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvedArtifacts.id, artifactId),
          eq(approvedArtifacts.status, "DELETING"),
          eq(approvedArtifacts.leaseOwner, workerId),
        ),
      )
      .returning({ id: approvedArtifacts.id });
    return rows.length === 1;
  }
  public setLegalHold(
    input: Parameters<ArtifactRepository["setLegalHold"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .update(approvedArtifacts)
        .set({ legalHold: input.enabled, updatedAt: input.now })
        .where(
          and(
            eq(approvedArtifacts.organizationId, input.organizationId),
            eq(approvedArtifacts.id, input.artifactId),
            inArray(approvedArtifacts.status, [
              "READY",
              "DELETION_RETRY",
              "DELETION_FAILED",
            ]),
          ),
        )
        .returning({ requestId: approvedArtifacts.requestId });
      if (!artifact) return false;
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: input.actorMembershipId,
        eventType: input.enabled
          ? "APPROVED_PDF_LEGAL_HOLD_APPLIED"
          : "APPROVED_PDF_LEGAL_HOLD_RELEASED",
        payload: { artifactId: input.artifactId },
      });
      return true;
    });
  }
}
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return JSON.stringify(value);
}
