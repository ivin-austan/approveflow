import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { outboxEvents, schema as databaseSchema } from "@approveflow/database";
import type { OutboxRepository } from "./outbox.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;
export class DrizzleOutboxRepository implements OutboxRepository {
  public constructor(private readonly database: Database) {}
  public claim(now: Date, staleBefore: Date, limit: number) {
    return this.database.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(outboxEvents)
        .where(
          and(
            or(
              eq(outboxEvents.status, "PENDING"),
              eq(outboxEvents.status, "FAILED"),
              and(
                eq(outboxEvents.status, "PROCESSING"),
                lte(outboxEvents.updatedAt, staleBefore),
              ),
            ),
            lte(outboxEvents.availableAt, now),
          ),
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (rows.length)
        await transaction
          .update(outboxEvents)
          .set({ status: "PROCESSING", updatedAt: now })
          .where(
            inArray(
              outboxEvents.id,
              rows.map((row) => row.id),
            ),
          );
      return rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        aggregateId: row.aggregateId,
        payload: row.payload,
      }));
    });
  }
  public async published(id: string, now: Date) {
    await this.database
      .update(outboxEvents)
      .set({ status: "PUBLISHED", publishedAt: now, updatedAt: now })
      .where(
        and(eq(outboxEvents.id, id), eq(outboxEvents.status, "PROCESSING")),
      );
  }
  public async failed(id: string, errorCode: string, retryAt: Date, now: Date) {
    await this.database
      .update(outboxEvents)
      .set({
        status: "FAILED",
        lastError: errorCode,
        availableAt: retryAt,
        attempts: sql`${outboxEvents.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(eq(outboxEvents.id, id), eq(outboxEvents.status, "PROCESSING")),
      );
  }
}
