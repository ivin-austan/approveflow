import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvalTasks,
  documentTypes,
  membershipRoles,
  memberships,
  notificationDeliveries,
  requests,
  runtimeStages,
  schema as databaseSchema,
  users,
} from "@approveflow/database";
import type { NotificationRepository } from "./notification.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleNotificationRepository implements NotificationRepository {
  public constructor(private readonly database: Database) {}

  public prepareStageEvent(
    input: Parameters<NotificationRepository["prepareStageEvent"]>[0],
  ) {
    return this.database.transaction(async (transaction) => {
      const [context] = await transaction
        .select({
          organizationId: runtimeStages.organizationId,
          requestId: runtimeStages.requestId,
          stageName: runtimeStages.name,
          dueAt: runtimeStages.dueAt,
          requestNumber: requests.requestNumber,
          title: requests.title,
          status: requests.status,
          documentType: documentTypes.name,
          requesterId: requests.requesterMembershipId,
        })
        .from(runtimeStages)
        .innerJoin(
          requests,
          and(
            eq(requests.organizationId, runtimeStages.organizationId),
            eq(requests.id, runtimeStages.requestId),
          ),
        )
        .innerJoin(
          documentTypes,
          and(
            eq(documentTypes.organizationId, requests.organizationId),
            eq(documentTypes.id, requests.documentTypeId),
          ),
        )
        .where(eq(runtimeStages.id, input.runtimeStageId));
      if (!context) return 0;
      const recipientIds = await resolveRecipients(
        transaction,
        context.organizationId,
        input.runtimeStageId,
        input.recipientPolicy,
      );
      if (recipientIds.length === 0) return 0;
      const recipients = await transaction
        .select({
          membershipId: memberships.id,
          membershipStatus: memberships.status,
          userStatus: users.status,
          email: users.email,
          emailVerifiedAt: users.emailVerifiedAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, context.organizationId),
            inArray(memberships.id, recipientIds),
          ),
        );
      const returnTo = `/organizations/${context.organizationId}/approvals?requestId=${context.requestId}`;
      const signInUrl = `${input.webOrigin}/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
      const subject = `${context.documentType} ${context.requestNumber ?? context.title}: ${context.stageName}`;
      const action = actionText(input.eventType);
      const body = [
        `Document: ${context.documentType} ${context.requestNumber ?? context.title}`,
        `Current status: ${context.status}`,
        `Current stage: ${context.stageName}`,
        `Required action: ${action}`,
        `Due date: ${context.dueAt?.toISOString() ?? "Not configured"}`,
        `Review Document: ${signInUrl}`,
      ].join("\n");
      for (const recipient of recipients) {
        const eligible =
          recipient.membershipStatus === "ACTIVE" &&
          recipient.userStatus === "ACTIVE" &&
          recipient.emailVerifiedAt !== null;
        await transaction
          .insert(notificationDeliveries)
          .values({
            organizationId: context.organizationId,
            requestId: context.requestId,
            runtimeStageId: input.runtimeStageId,
            sourceEventId: input.sourceEventId,
            eventType: input.eventType,
            recipientMembershipId: recipient.membershipId,
            recipientEmail: recipient.email,
            subject,
            body,
            status: eligible ? "PENDING" : "PERMANENTLY_FAILED",
            providerIdempotencyKey: `notification:${input.sourceEventId}:${recipient.membershipId}`,
            lastErrorCode: eligible ? null : "RECIPIENT_INELIGIBLE",
          })
          .onConflictDoNothing();
      }
      return recipients.length;
    });
  }

  public claim(workerId: string, now: Date, leaseUntil: Date) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          delivery: notificationDeliveries,
          currentEmail: users.email,
          emailVerifiedAt: users.emailVerifiedAt,
          userStatus: users.status,
          membershipStatus: memberships.status,
        })
        .from(notificationDeliveries)
        .innerJoin(
          memberships,
          and(
            eq(
              memberships.organizationId,
              notificationDeliveries.organizationId,
            ),
            eq(memberships.id, notificationDeliveries.recipientMembershipId),
          ),
        )
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(notificationDeliveries.status, [
              "PENDING",
              "RETRY_SCHEDULED",
              "RECONCILING",
              "SENDING",
            ]),
            or(
              isNull(notificationDeliveries.nextAttemptAt),
              lte(notificationDeliveries.nextAttemptAt, now),
            ),
            or(
              isNull(notificationDeliveries.leaseExpiresAt),
              lte(notificationDeliveries.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(notificationDeliveries.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row || row.delivery.attempts >= 8) return null;
      await transaction
        .update(notificationDeliveries)
        .set({
          status: "SENDING",
          attempts: row.delivery.attempts + 1,
          leaseOwner: workerId,
          leaseExpiresAt: leaseUntil,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, row.delivery.id));
      return {
        id: row.delivery.id,
        recipientEmail: row.delivery.recipientEmail,
        subject: row.delivery.subject,
        body: row.delivery.body,
        providerIdempotencyKey: row.delivery.providerIdempotencyKey,
        attempts: row.delivery.attempts + 1,
        eligible:
          row.membershipStatus === "ACTIVE" &&
          row.userStatus === "ACTIVE" &&
          row.emailVerifiedAt !== null &&
          row.currentEmail === row.delivery.recipientEmail,
      };
    });
  }

  public async accepted(
    id: string,
    workerId: string,
    messageId: string,
    now: Date,
  ) {
    const rows = await this.database
      .update(notificationDeliveries)
      .set({
        status: "ACCEPTED",
        providerMessageId: messageId,
        acceptedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.id, id),
          eq(notificationDeliveries.status, "SENDING"),
          eq(notificationDeliveries.leaseOwner, workerId),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    return rows.length === 1;
  }

  public async retry(
    id: string,
    workerId: string,
    status: "RECONCILING" | "RETRY_SCHEDULED" | "PERMANENTLY_FAILED",
    errorCode: string,
    nextAttemptAt: Date | null,
    now: Date,
  ) {
    const rows = await this.database
      .update(notificationDeliveries)
      .set({
        status,
        lastErrorCode: errorCode,
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(notificationDeliveries.id, id),
          eq(notificationDeliveries.status, "SENDING"),
          eq(notificationDeliveries.leaseOwner, workerId),
        ),
      )
      .returning({ id: notificationDeliveries.id });
    return rows.length === 1;
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function resolveRecipients(
  transaction: Transaction,
  organizationId: string,
  runtimeStageId: string,
  policy: Readonly<Record<string, unknown>> | null | undefined,
) {
  if (policy?.type === "MEMBERSHIPS" && Array.isArray(policy.membershipIds))
    return policy.membershipIds.filter(
      (value): value is string => typeof value === "string",
    );
  if (policy?.type === "ROLES" && Array.isArray(policy.roleIds)) {
    const roleIds = policy.roleIds.filter(
      (value): value is string => typeof value === "string",
    );
    if (roleIds.length === 0) return [];
    const rows = await transaction
      .select({ membershipId: membershipRoles.membershipId })
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.organizationId, organizationId),
          inArray(membershipRoles.roleId, roleIds),
        ),
      );
    return [...new Set(rows.map((row) => row.membershipId))];
  }
  const rows = await transaction
    .select({ membershipId: approvalTasks.assignedMembershipId })
    .from(approvalTasks)
    .where(
      and(
        eq(approvalTasks.organizationId, organizationId),
        eq(approvalTasks.runtimeStageId, runtimeStageId),
      ),
    );
  return [...new Set(rows.map((row) => row.membershipId))];
}

function actionText(eventType: string) {
  if (eventType === "STAGE_REMINDER_DUE") return "Review reminder";
  if (eventType === "STAGE_ESCALATION_NOTIFICATION_DUE")
    return "Escalated review required";
  return "Review and decide";
}
