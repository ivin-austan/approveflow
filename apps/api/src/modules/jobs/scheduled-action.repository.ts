import { and, asc, eq, lte, ne } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvalRounds,
  approvalTasks,
  approvedArtifacts,
  artifactDeliveries,
  auditEvents,
  documentTypes,
  documentTypeRecipients,
  memberships,
  outboxEvents,
  requests,
  runtimeStages,
  scheduledStageActions,
  schema as databaseSchema,
  users,
} from "@approveflow/database";

type Database = NodePgDatabase<typeof databaseSchema>;

export class ScheduledActionRepository {
  public constructor(private readonly database: Database) {}

  public processNext(now: Date): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [action] = await transaction
        .select()
        .from(scheduledStageActions)
        .where(
          and(
            eq(scheduledStageActions.status, "PENDING"),
            lte(scheduledStageActions.scheduledFor, now),
          ),
        )
        .orderBy(asc(scheduledStageActions.scheduledFor))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!action) return false;
      const [stage] = await transaction
        .select()
        .from(runtimeStages)
        .where(
          and(
            eq(runtimeStages.organizationId, action.organizationId),
            eq(runtimeStages.id, action.runtimeStageId),
          ),
        )
        .for("update");
      if (stage?.status !== "ACTIVE") {
        await transaction
          .update(scheduledStageActions)
          .set({ status: "CANCELLED", completedAt: now, updatedAt: now })
          .where(eq(scheduledStageActions.id, action.id));
        return true;
      }
      if (action.kind === "REMINDER" || action.kind === "ESCALATION_NOTIFY") {
        await transaction.insert(outboxEvents).values({
          organizationId: action.organizationId,
          aggregateType: "RUNTIME_STAGE",
          aggregateId: stage.id,
          eventType:
            action.kind === "REMINDER"
              ? "STAGE_REMINDER_DUE"
              : "STAGE_ESCALATION_NOTIFICATION_DUE",
          payload: {
            requestId: stage.requestId,
            runtimeStageId: stage.id,
            scheduledActionId: action.id,
            recipientPolicy: action.recipientPolicy,
          },
        });
        await completeAction(transaction, action.id, now);
        return true;
      }
      const [request] = await transaction
        .select()
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, action.organizationId),
            eq(requests.id, stage.requestId),
          ),
        )
        .for("update");
      if (request?.status !== "IN_REVIEW") {
        await transaction
          .update(scheduledStageActions)
          .set({ status: "CANCELLED", completedAt: now, updatedAt: now })
          .where(eq(scheduledStageActions.id, action.id));
        return true;
      }
      if (action.kind === "ESCALATION_RETURN") {
        await transaction
          .update(approvalTasks)
          .set({ status: "SKIPPED", decidedAt: now })
          .where(
            and(
              eq(approvalTasks.organizationId, action.organizationId),
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
            status: "RETURNED",
            completedAt: now,
            revision: request.revision + 1,
            updatedAt: now,
          })
          .where(eq(requests.id, request.id));
        await recordSystemEvent(
          transaction,
          action.organizationId,
          request.id,
          stage.id,
          "ESCALATION_RETURNED_TO_INITIATOR",
          action.id,
          now,
        );
        await completeAction(transaction, action.id, now);
        return true;
      }

      await transaction
        .update(approvalTasks)
        .set({ status: "SKIPPED", decidedAt: now })
        .where(
          and(
            eq(approvalTasks.organizationId, action.organizationId),
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
            eq(runtimeStages.organizationId, action.organizationId),
            eq(runtimeStages.approvalRoundId, stage.approvalRoundId),
            eq(runtimeStages.status, "PENDING"),
          ),
        )
        .orderBy(asc(runtimeStages.levelNumber))
        .limit(1)
        .for("update");
      if (next) {
        await transaction
          .update(runtimeStages)
          .set({ status: "ACTIVE", activatedAt: now })
          .where(eq(runtimeStages.id, next.id));
        await transaction
          .update(approvalTasks)
          .set({ status: "ACTIVE", activatedAt: now })
          .where(
            and(
              eq(approvalTasks.organizationId, action.organizationId),
              eq(approvalTasks.runtimeStageId, next.id),
              eq(approvalTasks.status, "PENDING"),
            ),
          );
      } else {
        await finalizeRequest(
          transaction,
          action.organizationId,
          request,
          stage.approvalRoundId,
          now,
        );
      }
      await recordSystemEvent(
        transaction,
        action.organizationId,
        request.id,
        stage.id,
        "AUTOMATICALLY_APPROVED",
        action.id,
        now,
      );
      await completeAction(transaction, action.id, now);
      return true;
    });
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function completeAction(transaction: Transaction, id: string, now: Date) {
  await transaction
    .update(scheduledStageActions)
    .set({
      status: "COMPLETED",
      completedAt: now,
      attempts: 1,
      updatedAt: now,
    })
    .where(eq(scheduledStageActions.id, id));
}

async function recordSystemEvent(
  transaction: Transaction,
  organizationId: string,
  requestId: string,
  stageId: string,
  eventType: string,
  actionId: string,
  now: Date,
) {
  await transaction.insert(auditEvents).values({
    organizationId,
    requestId,
    actorMembershipId: null,
    eventType,
    payload: {
      stageId,
      scheduledActionId: actionId,
      approverName: "System",
      decision:
        eventType === "AUTOMATICALLY_APPROVED" ? "APPROVED" : "RETURNED",
      occurredAt: now.toISOString(),
    },
  });
  await transaction.insert(outboxEvents).values({
    organizationId,
    aggregateType: "REQUEST",
    aggregateId: requestId,
    eventType,
    payload: { stageId, scheduledActionId: actionId },
  });
}

async function finalizeRequest(
  transaction: Transaction,
  organizationId: string,
  request: typeof requests.$inferSelect,
  approvalRoundId: string,
  now: Date,
) {
  await transaction
    .update(approvalRounds)
    .set({ status: "COMPLETED", completedAt: now })
    .where(eq(approvalRounds.id, approvalRoundId));
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
    .select({ retentionYears: documentTypes.approvedPdfRetentionYears })
    .from(documentTypes)
    .where(
      and(
        eq(documentTypes.organizationId, organizationId),
        eq(documentTypes.id, request.documentTypeId),
      ),
    );
  if (!documentType) throw new Error("Document type missing at final approval");
  const [artifact] = await transaction
    .insert(approvedArtifacts)
    .values({
      organizationId,
      requestId: request.id,
      approvalRoundId,
      objectKey: `${organizationId}/requests/${request.id}/rounds/${approvalRoundId}/approved.pdf`,
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
  if (!artifact) return;
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
        eq(memberships.organizationId, organizationId),
        eq(memberships.id, request.requesterMembershipId),
      ),
    );
  if (!recipient)
    throw new Error("Request initiator missing at final approval");
  const eligible =
    recipient.membershipStatus === "ACTIVE" &&
    recipient.emailVerifiedAt !== null;
  await transaction.insert(artifactDeliveries).values({
    organizationId,
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
      userStatus: users.status,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(documentTypeRecipients)
    .innerJoin(
      memberships,
      and(
        eq(memberships.organizationId, documentTypeRecipients.organizationId),
        eq(memberships.id, documentTypeRecipients.membershipId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(documentTypeRecipients.organizationId, organizationId),
        eq(documentTypeRecipients.documentTypeId, request.documentTypeId),
        ne(memberships.id, request.requesterMembershipId),
      ),
    );
  for (const configured of configuredRecipients) {
    const configuredEligible =
      configured.membershipStatus === "ACTIVE" &&
      configured.userStatus === "ACTIVE" &&
      configured.emailVerifiedAt !== null;
    await transaction.insert(artifactDeliveries).values({
      organizationId,
      artifactId: artifact.id,
      recipientMembershipId: configured.membershipId,
      recipientEmail: configured.email,
      recipientKind: "CONFIGURED",
      mode: "LINK_ONLY",
      status: configuredEligible ? "PENDING" : "PERMANENTLY_FAILED",
      providerIdempotencyKey: `approved-artifact:${artifact.id}:configured:${configured.membershipId}`,
      lastErrorCode: configuredEligible ? null : "RECIPIENT_INELIGIBLE",
    });
  }
  await transaction.insert(outboxEvents).values({
    organizationId,
    aggregateType: "APPROVED_ARTIFACT",
    aggregateId: artifact.id,
    eventType: "APPROVED_ARTIFACT_GENERATION_REQUESTED",
    payload: { artifactId: artifact.id, requestId: request.id },
  });
}
