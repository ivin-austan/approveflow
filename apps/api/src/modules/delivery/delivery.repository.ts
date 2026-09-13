import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvedArtifacts,
  artifactDeliveries,
  auditEvents,
  memberships,
  schema as databaseSchema,
  users,
} from "@approveflow/database";
import type { DeliveryRepository } from "./delivery.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;
export class DrizzleDeliveryRepository implements DeliveryRepository {
  public constructor(private readonly database: Database) {}
  public claim(workerId: string, now: Date, leaseUntil: Date) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          delivery: artifactDeliveries,
          artifact: approvedArtifacts,
          currentEmail: users.email,
          emailVerifiedAt: users.emailVerifiedAt,
          membershipStatus: memberships.status,
        })
        .from(artifactDeliveries)
        .innerJoin(
          approvedArtifacts,
          and(
            eq(
              approvedArtifacts.organizationId,
              artifactDeliveries.organizationId,
            ),
            eq(approvedArtifacts.id, artifactDeliveries.artifactId),
          ),
        )
        .leftJoin(
          memberships,
          and(
            eq(memberships.organizationId, artifactDeliveries.organizationId),
            eq(memberships.id, artifactDeliveries.recipientMembershipId),
          ),
        )
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(approvedArtifacts.status, "READY"),
            inArray(artifactDeliveries.status, [
              "PENDING",
              "RETRY_SCHEDULED",
              "RECONCILING",
              "SENDING",
            ]),
            or(
              isNull(artifactDeliveries.nextAttemptAt),
              lte(artifactDeliveries.nextAttemptAt, now),
            ),
            or(
              isNull(artifactDeliveries.leaseExpiresAt),
              lte(artifactDeliveries.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(artifactDeliveries.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (
        !row?.artifact.sha256 ||
        row.artifact.sizeBytes === null ||
        row.delivery.attempts >= 8
      )
        return null;
      await transaction
        .update(artifactDeliveries)
        .set({
          status: "SENDING",
          attempts: row.delivery.attempts + 1,
          leaseOwner: workerId,
          leaseExpiresAt: leaseUntil,
          updatedAt: now,
        })
        .where(eq(artifactDeliveries.id, row.delivery.id));
      return {
        id: row.delivery.id,
        organizationId: row.delivery.organizationId,
        requestId: row.artifact.requestId,
        artifactId: row.artifact.id,
        objectKey: row.artifact.objectKey,
        sha256: row.artifact.sha256,
        sizeBytes: row.artifact.sizeBytes,
        recipientEmail: row.delivery.recipientEmail,
        providerIdempotencyKey: row.delivery.providerIdempotencyKey,
        mode: row.delivery.mode,
        attempts: row.delivery.attempts + 1,
        eligible:
          row.membershipStatus === "ACTIVE" &&
          row.emailVerifiedAt !== null &&
          row.currentEmail === row.delivery.recipientEmail,
      };
    });
  }
  public async accepted(
    id: string,
    workerId: string,
    providerMessageId: string,
    now: Date,
  ) {
    const [row] = await this.database
      .update(artifactDeliveries)
      .set({
        status: "ACCEPTED",
        providerMessageId,
        acceptedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(artifactDeliveries.id, id),
          eq(artifactDeliveries.status, "SENDING"),
          eq(artifactDeliveries.leaseOwner, workerId),
        ),
      )
      .returning({
        organizationId: artifactDeliveries.organizationId,
        artifactId: artifactDeliveries.artifactId,
      });
    if (!row) return false;
    const [artifact] = await this.database
      .select({ requestId: approvedArtifacts.requestId })
      .from(approvedArtifacts)
      .where(
        and(
          eq(approvedArtifacts.organizationId, row.organizationId),
          eq(approvedArtifacts.id, row.artifactId),
        ),
      );
    if (artifact)
      await this.database.insert(auditEvents).values({
        organizationId: row.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: null,
        eventType: "APPROVED_PDF_EMAILED",
        payload: { artifactId: row.artifactId, deliveryId: id },
      });
    return true;
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
      .update(artifactDeliveries)
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
          eq(artifactDeliveries.id, id),
          eq(artifactDeliveries.status, "SENDING"),
          eq(artifactDeliveries.leaseOwner, workerId),
        ),
      )
      .returning({ id: artifactDeliveries.id });
    return rows.length === 1;
  }
  public async linkOnly(
    id: string,
    workerId: string,
    reason: "SIZE_LIMIT",
    now: Date,
  ) {
    const rows = await this.database
      .update(artifactDeliveries)
      .set({ mode: "LINK_ONLY", lastErrorCode: reason, updatedAt: now })
      .where(
        and(
          eq(artifactDeliveries.id, id),
          eq(artifactDeliveries.status, "SENDING"),
          eq(artifactDeliveries.leaseOwner, workerId),
        ),
      )
      .returning({ id: artifactDeliveries.id });
    return rows.length === 1;
  }
  public reopen(input: Parameters<DeliveryRepository["reopen"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [delivery] = await transaction
        .update(artifactDeliveries)
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
            eq(artifactDeliveries.organizationId, input.organizationId),
            eq(artifactDeliveries.id, input.deliveryId),
            eq(artifactDeliveries.status, "PERMANENTLY_FAILED"),
          ),
        )
        .returning({
          id: artifactDeliveries.id,
          artifactId: artifactDeliveries.artifactId,
        });
      if (!delivery) return false;
      const [artifact] = await transaction
        .select({ requestId: approvedArtifacts.requestId })
        .from(approvedArtifacts)
        .where(
          and(
            eq(approvedArtifacts.organizationId, input.organizationId),
            eq(approvedArtifacts.id, delivery.artifactId),
          ),
        );
      if (!artifact) throw new Error("Delivery artifact is missing");
      await transaction.insert(auditEvents).values({
        organizationId: input.organizationId,
        requestId: artifact.requestId,
        actorMembershipId: input.actorMembershipId,
        eventType: "APPROVED_PDF_DELIVERY_REOPENED",
        payload: { artifactId: delivery.artifactId, deliveryId: delivery.id },
      });
      return true;
    });
  }
}
