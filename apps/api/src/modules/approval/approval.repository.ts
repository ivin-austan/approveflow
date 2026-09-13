import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvalRounds,
  approvalTasks,
  approvedArtifacts,
  artifactDeliveries,
  auditEvents,
  documentTypes,
  documentTypeRecipients,
  idempotencyRecords,
  memberships,
  outboxEvents,
  requests,
  runtimeStages,
  schema as databaseSchema,
  users,
  workflowVersions,
} from "@approveflow/database";
import type { ApprovalRepository } from "./approval.service.js";
import {
  canTransitionRequest,
  canTransitionStage,
  canTransitionTask,
} from "./transitions.js";

type Database = NodePgDatabase<typeof databaseSchema>;
export class DrizzleApprovalRepository implements ApprovalRepository {
  public constructor(private readonly database: Database) {}
  public inbox(organizationId: string, membershipId: string) {
    return this.database
      .select({
        id: approvalTasks.id,
        requestId: approvalTasks.requestId,
        requestNumber: sql<string>`coalesce(${requests.requestNumber}, '')`,
        requestTitle: requests.title,
        requestRevision: requests.revision,
        stageName: runtimeStages.name,
        activatedAt: sql<Date>`${approvalTasks.activatedAt}`,
      })
      .from(approvalTasks)
      .innerJoin(
        requests,
        and(
          eq(requests.organizationId, approvalTasks.organizationId),
          eq(requests.id, approvalTasks.requestId),
        ),
      )
      .innerJoin(
        runtimeStages,
        and(
          eq(runtimeStages.organizationId, approvalTasks.organizationId),
          eq(runtimeStages.id, approvalTasks.runtimeStageId),
        ),
      )
      .where(
        and(
          eq(approvalTasks.organizationId, organizationId),
          eq(approvalTasks.assignedMembershipId, membershipId),
          eq(approvalTasks.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(approvalTasks.activatedAt));
  }

  public decide(input: Parameters<ApprovalRepository["decide"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [taskReference] = await transaction
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.organizationId, input.organizationId),
            eq(approvalTasks.id, input.taskId),
            eq(approvalTasks.assignedMembershipId, input.membershipId),
          ),
        );
      if (!taskReference) return "NOT_FOUND" as const;
      const operation = `approval.decide:${input.taskId}`;
      const [request] = await transaction
        .select()
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, taskReference.requestId),
          ),
        )
        .for("update");
      if (!request) return "NOT_FOUND" as const;
      const [task] = await transaction
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.organizationId, input.organizationId),
            eq(approvalTasks.id, input.taskId),
            eq(approvalTasks.assignedMembershipId, input.membershipId),
            eq(approvalTasks.requestId, request.id),
          ),
        )
        .for("update");
      if (!task) return "NOT_FOUND" as const;
      const prior = await this.idempotency(transaction, input, operation);
      if (prior === "MISMATCH") return "IDEMPOTENCY_MISMATCH" as const;
      if (prior === "REPLAY") return "REPLAY" as const;
      if (
        task.status !== "ACTIVE" ||
        request.status !== "IN_REVIEW" ||
        request.revision !== input.expectedRequestRevision
      )
        return "STALE" as const;
      const [version] = await transaction
        .select({ allow: workflowVersions.allowRequesterSelfApproval })
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.organizationId, input.organizationId),
            eq(workflowVersions.id, request.workflowVersionId),
          ),
        );
      if (
        request.requesterMembershipId === input.membershipId &&
        !version?.allow
      )
        return "SELF_APPROVAL_DENIED" as const;
      await this.createIdempotency(transaction, input, operation);
      const now = new Date();
      const taskTarget =
        input.action === "APPROVE"
          ? "APPROVED"
          : input.action === "REJECT"
            ? "REJECTED"
            : "RETURNED";
      requireTransition(canTransitionTask(task.status, taskTarget));
      await transaction
        .update(approvalTasks)
        .set({
          status: taskTarget,
          decidedAt: now,
        })
        .where(
          and(
            eq(approvalTasks.organizationId, input.organizationId),
            eq(approvalTasks.id, input.taskId),
          ),
        );
      const [stage] = await transaction
        .select()
        .from(runtimeStages)
        .where(
          and(
            eq(runtimeStages.organizationId, input.organizationId),
            eq(runtimeStages.id, task.runtimeStageId),
          ),
        )
        .for("update");
      if (!stage) return "NOT_FOUND" as const;
      if (input.action !== "APPROVE") {
        requireTransition(canTransitionStage(stage.status, "COMPLETED"));
        requireTransition(
          canTransitionRequest(
            request.status,
            input.action === "REJECT" ? "REJECTED" : "RETURNED",
          ),
        );
        await transaction
          .update(approvalTasks)
          .set({ status: "SKIPPED", decidedAt: now })
          .where(
            and(
              eq(approvalTasks.organizationId, input.organizationId),
              eq(approvalTasks.runtimeStageId, stage.id),
              eq(approvalTasks.status, "ACTIVE"),
            ),
          );
        await transaction
          .update(runtimeStages)
          .set({ status: "COMPLETED", completedAt: now })
          .where(eq(runtimeStages.id, stage.id));
        await transaction
          .update(approvalRounds)
          .set({ status: "COMPLETED", completedAt: now })
          .where(eq(approvalRounds.id, stage.approvalRoundId));
        await transaction
          .update(requests)
          .set({
            status: input.action === "REJECT" ? "REJECTED" : "RETURNED",
            completedAt: now,
            revision: request.revision + 1,
            updatedAt: now,
          })
          .where(eq(requests.id, request.id));
      } else {
        const remaining = await transaction
          .select({ id: approvalTasks.id })
          .from(approvalTasks)
          .where(
            and(
              eq(approvalTasks.organizationId, input.organizationId),
              eq(approvalTasks.runtimeStageId, stage.id),
              eq(approvalTasks.status, "ACTIVE"),
              ne(approvalTasks.id, task.id),
            ),
          );
        const complete =
          stage.completionPolicy === "ANY" || remaining.length === 0;
        if (complete) {
          requireTransition(canTransitionStage(stage.status, "COMPLETED"));
          if (stage.completionPolicy === "ANY")
            await transaction
              .update(approvalTasks)
              .set({ status: "SKIPPED", decidedAt: now })
              .where(
                and(
                  eq(approvalTasks.organizationId, input.organizationId),
                  eq(approvalTasks.runtimeStageId, stage.id),
                  eq(approvalTasks.status, "ACTIVE"),
                ),
              );
          await transaction
            .update(runtimeStages)
            .set({ status: "COMPLETED", completedAt: now })
            .where(eq(runtimeStages.id, stage.id));
          const [next] = await transaction
            .select()
            .from(runtimeStages)
            .where(
              and(
                eq(runtimeStages.organizationId, input.organizationId),
                eq(runtimeStages.approvalRoundId, stage.approvalRoundId),
                eq(runtimeStages.status, "PENDING"),
              ),
            )
            .orderBy(asc(runtimeStages.levelNumber))
            .limit(1)
            .for("update");
          if (next) {
            requireTransition(canTransitionStage(next.status, "ACTIVE"));
            await transaction
              .update(runtimeStages)
              .set({ status: "ACTIVE", activatedAt: now })
              .where(eq(runtimeStages.id, next.id));
            await transaction
              .update(approvalTasks)
              .set({ status: "ACTIVE", activatedAt: now })
              .where(
                and(
                  eq(approvalTasks.organizationId, input.organizationId),
                  eq(approvalTasks.runtimeStageId, next.id),
                  eq(approvalTasks.status, "PENDING"),
                ),
              );
          } else {
            requireTransition(canTransitionRequest(request.status, "APPROVED"));
            await transaction
              .update(approvalRounds)
              .set({ status: "COMPLETED", completedAt: now })
              .where(eq(approvalRounds.id, stage.approvalRoundId));
            await transaction
              .update(requests)
              .set({
                status: "APPROVED",
                completedAt: now,
                revision: request.revision + 1,
                updatedAt: now,
              })
              .where(eq(requests.id, request.id));
            const [documentType] = await transaction
              .select({
                retentionYears: documentTypes.approvedPdfRetentionYears,
              })
              .from(documentTypes)
              .where(
                and(
                  eq(documentTypes.organizationId, input.organizationId),
                  eq(documentTypes.id, request.documentTypeId),
                ),
              );
            if (!documentType)
              throw new Error("Document type missing at final approval");
            const [artifact] = await transaction
              .insert(approvedArtifacts)
              .values({
                organizationId: input.organizationId,
                requestId: request.id,
                approvalRoundId: stage.approvalRoundId,
                objectKey: `${input.organizationId}/requests/${request.id}/rounds/${stage.approvalRoundId}/approved.pdf`,
                rendererVersion: "approveflow-jspdf-v1",
                retentionUntil: new Date(
                  Date.UTC(
                    now.getUTCFullYear() + documentType.retentionYears,
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    now.getUTCHours(),
                    now.getUTCMinutes(),
                    now.getUTCSeconds(),
                  ),
                ),
              })
              .onConflictDoNothing()
              .returning();
            if (artifact) {
              const [recipient] = await transaction
                .select({
                  membershipStatus: memberships.status,
                  email: users.email,
                  emailVerifiedAt: users.emailVerifiedAt,
                })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(
                  and(
                    eq(memberships.organizationId, input.organizationId),
                    eq(memberships.id, request.requesterMembershipId),
                  ),
                );
              if (!recipient)
                throw new Error("Request initiator missing at final approval");
              const eligible =
                recipient.membershipStatus === "ACTIVE" &&
                recipient.emailVerifiedAt !== null;
              await transaction.insert(artifactDeliveries).values({
                organizationId: input.organizationId,
                artifactId: artifact.id,
                recipientMembershipId: request.requesterMembershipId,
                recipientEmail: recipient.email,
                recipientKind: "INITIATOR",
                mode: "ATTACHMENT",
                status: eligible ? "PENDING" : "PERMANENTLY_FAILED",
                providerIdempotencyKey: `approved-artifact:${artifact.id}:initiator`,
                lastErrorCode: eligible ? null : "RECIPIENT_INELIGIBLE",
              });
              const configuredRecipients = await transaction
                .select({
                  membershipId: memberships.id,
                  membershipStatus: memberships.status,
                  email: users.email,
                  emailVerifiedAt: users.emailVerifiedAt,
                  userStatus: users.status,
                })
                .from(documentTypeRecipients)
                .innerJoin(
                  memberships,
                  and(
                    eq(
                      memberships.organizationId,
                      documentTypeRecipients.organizationId,
                    ),
                    eq(memberships.id, documentTypeRecipients.membershipId),
                  ),
                )
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(
                  and(
                    eq(
                      documentTypeRecipients.organizationId,
                      input.organizationId,
                    ),
                    eq(
                      documentTypeRecipients.documentTypeId,
                      request.documentTypeId,
                    ),
                    ne(memberships.id, request.requesterMembershipId),
                  ),
                );
              for (const configured of configuredRecipients) {
                const configuredEligible =
                  configured.membershipStatus === "ACTIVE" &&
                  configured.userStatus === "ACTIVE" &&
                  configured.emailVerifiedAt !== null;
                await transaction.insert(artifactDeliveries).values({
                  organizationId: input.organizationId,
                  artifactId: artifact.id,
                  recipientMembershipId: configured.membershipId,
                  recipientEmail: configured.email,
                  recipientKind: "CONFIGURED",
                  mode: "LINK_ONLY",
                  status: configuredEligible ? "PENDING" : "PERMANENTLY_FAILED",
                  providerIdempotencyKey: `approved-artifact:${artifact.id}:configured:${configured.membershipId}`,
                  lastErrorCode: configuredEligible
                    ? null
                    : "RECIPIENT_INELIGIBLE",
                });
              }
              await transaction.insert(outboxEvents).values({
                organizationId: input.organizationId,
                aggregateType: "APPROVED_ARTIFACT",
                aggregateId: artifact.id,
                eventType: "APPROVED_ARTIFACT_GENERATION_REQUESTED",
                payload: { artifactId: artifact.id, requestId: request.id },
              });
            }
          }
        }
      }
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: request.id,
        actorMembershipId: input.membershipId,
        eventType: `APPROVAL_${input.action}`,
        payload: {
          taskId: input.taskId,
          stageId: stage.id,
          approverName: task.assigneeName,
          comment: input.comment,
        },
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "REQUEST",
        aggregateId: request.id,
        eventType: `APPROVAL_${input.action}`,
        payload: { taskId: input.taskId },
      });
      await this.completeIdempotency(transaction, input, operation);
      return "DECIDED" as const;
    });
  }

  public reassign(input: Parameters<ApprovalRepository["reassign"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [taskReference] = await transaction
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.organizationId, input.organizationId),
            eq(approvalTasks.id, input.taskId),
          ),
        );
      if (!taskReference) return "NOT_FOUND" as const;
      const operation = `approval.reassign:${input.taskId}`;
      const [request] = await transaction
        .select()
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, input.organizationId),
            eq(requests.id, taskReference.requestId),
          ),
        )
        .for("update");
      if (!request) return "NOT_FOUND" as const;
      const [task] = await transaction
        .select()
        .from(approvalTasks)
        .where(
          and(
            eq(approvalTasks.organizationId, input.organizationId),
            eq(approvalTasks.id, input.taskId),
            eq(approvalTasks.requestId, request.id),
          ),
        )
        .for("update");
      if (!task) return "NOT_FOUND" as const;
      const prior = await this.idempotency(transaction, input, operation);
      if (prior === "MISMATCH") return "IDEMPOTENCY_MISMATCH" as const;
      if (prior === "REPLAY") return "REPLAY" as const;
      if (
        task.status !== "ACTIVE" ||
        request.revision !== input.expectedRequestRevision
      )
        return "STALE" as const;
      const [replacement] = await transaction
        .select({
          id: memberships.id,
          name: users.fullName,
          email: users.email,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, input.organizationId),
            eq(memberships.id, input.replacementMembershipId),
            eq(memberships.status, "ACTIVE"),
          ),
        );
      if (!replacement) return "INVALID_REPLACEMENT" as const;
      await this.createIdempotency(transaction, input, operation);
      const now = new Date();
      requireTransition(canTransitionTask(task.status, "REASSIGNED"));
      await transaction
        .update(approvalTasks)
        .set({ status: "REASSIGNED", decidedAt: now })
        .where(eq(approvalTasks.id, task.id));
      await transaction.insert(approvalTasks).values({
        organizationId: input.organizationId,
        requestId: task.requestId,
        runtimeStageId: task.runtimeStageId,
        assignedMembershipId: replacement.id,
        assigneeName: replacement.name,
        assigneeEmail: replacement.email,
        status: "ACTIVE",
        activatedAt: now,
      });
      await transaction
        .update(requests)
        .set({ revision: request.revision + 1, updatedAt: now })
        .where(eq(requests.id, request.id));
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: request.id,
        actorMembershipId: input.membershipId,
        eventType: "APPROVAL_REASSIGNED",
        payload: {
          originalTaskId: task.id,
          replacementMembershipId: replacement.id,
          comment: input.comment,
        },
      });
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        aggregateType: "REQUEST",
        aggregateId: request.id,
        eventType: "APPROVAL_REASSIGNED",
        payload: { replacementMembershipId: replacement.id },
      });
      await this.completeIdempotency(transaction, input, operation);
      return "REASSIGNED" as const;
    });
  }

  private async idempotency(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: {
      organizationId: string;
      membershipId: string;
      idempotencyKey: string;
      requestHash: string;
    },
    operation: string,
  ) {
    const [row] = await transaction
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, input.organizationId),
          eq(idempotencyRecords.actorMembershipId, input.membershipId),
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.key, input.idempotencyKey),
        ),
      )
      .for("update");
    return !row
      ? ("NONE" as const)
      : row.requestHash === input.requestHash && row.status === "COMPLETED"
        ? ("REPLAY" as const)
        : row.requestHash !== input.requestHash
          ? ("MISMATCH" as const)
          : ("NONE" as const);
  }
  private createIdempotency(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: {
      organizationId: string;
      membershipId: string;
      idempotencyKey: string;
      requestHash: string;
    },
    operation: string,
  ) {
    return transaction.insert(idempotencyRecords).values({
      organizationId: input.organizationId,
      actorMembershipId: input.membershipId,
      operation,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }
  private completeIdempotency(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    input: {
      organizationId: string;
      membershipId: string;
      idempotencyKey: string;
    },
    operation: string,
  ) {
    return transaction
      .update(idempotencyRecords)
      .set({
        status: "COMPLETED",
        responseStatus: 204,
        responseBody: {},
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyRecords.organizationId, input.organizationId),
          eq(idempotencyRecords.actorMembershipId, input.membershipId),
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.key, input.idempotencyKey),
        ),
      );
  }
}

function requireTransition(valid: boolean): void {
  if (!valid) throw new Error("Invalid approval state transition");
}
