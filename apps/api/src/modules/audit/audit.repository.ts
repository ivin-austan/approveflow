import { and, asc, eq, exists, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  approvalTasks,
  auditEvents,
  requests,
  runtimeStages,
  schema as databaseSchema,
} from "@approveflow/database";
import type { AuditRepository } from "./audit.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleAuditRepository implements AuditRepository {
  public constructor(private readonly database: Database) {}
  public async timeline(input: Parameters<AuditRepository["timeline"]>[0]) {
    const access = input.canReadAll
      ? undefined
      : or(
          eq(requests.requesterMembershipId, input.membershipId),
          input.canReadAssigned
            ? exists(
                this.database
                  .select({ id: approvalTasks.id })
                  .from(approvalTasks)
                  .where(
                    and(
                      eq(approvalTasks.organizationId, input.organizationId),
                      eq(approvalTasks.requestId, requests.id),
                      eq(
                        approvalTasks.assignedMembershipId,
                        input.membershipId,
                      ),
                    ),
                  ),
              )
            : undefined,
        );
    const [request] = await this.database
      .select({
        id: requests.id,
        requestNumber: requests.requestNumber,
        title: requests.title,
        status: requests.status,
        revision: requests.revision,
      })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, input.organizationId),
          eq(requests.id, input.requestId),
          access,
        ),
      );
    if (!request) return null;
    const stages = await this.database
      .select()
      .from(runtimeStages)
      .where(
        and(
          eq(runtimeStages.organizationId, input.organizationId),
          eq(runtimeStages.requestId, input.requestId),
        ),
      )
      .orderBy(asc(runtimeStages.createdAt), asc(runtimeStages.levelNumber));
    const tasks = await this.database
      .select({
        id: approvalTasks.id,
        runtimeStageId: approvalTasks.runtimeStageId,
        assigneeName: approvalTasks.assigneeName,
        status: approvalTasks.status,
        activatedAt: approvalTasks.activatedAt,
        decidedAt: approvalTasks.decidedAt,
      })
      .from(approvalTasks)
      .where(
        and(
          eq(approvalTasks.organizationId, input.organizationId),
          eq(approvalTasks.requestId, input.requestId),
        ),
      )
      .orderBy(asc(approvalTasks.createdAt));
    const events = await this.database
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        payload: auditEvents.payload,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, input.organizationId),
          eq(auditEvents.requestId, input.requestId),
        ),
      )
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));
    return {
      request,
      stages: stages.map((stage) => ({
        id: stage.id,
        levelNumber: stage.levelNumber,
        name: stage.name,
        status: stage.status,
        isFinal: stage.isFinal,
        activatedAt: stage.activatedAt,
        dueAt: stage.dueAt,
        completedAt: stage.completedAt,
        tasks: tasks.filter((task) => task.runtimeStageId === stage.id),
      })),
      events,
    };
  }
}
