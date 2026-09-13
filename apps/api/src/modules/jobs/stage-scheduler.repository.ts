import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  businessCalendarHolidays,
  businessCalendarWorkPeriods,
  businessCalendars,
  outboxEvents,
  runtimeStages,
  scheduledStageActions,
  schema as databaseSchema,
  stageEscalationRules,
  stageReminderRules,
  workflowStages,
  workflowVersions,
} from "@approveflow/database";
import { addBusinessMinutes, type BusinessCalendar } from "./business-time.js";

type Database = NodePgDatabase<typeof databaseSchema>;
type DurationUnit = "BUSINESS_HOURS" | "BUSINESS_DAYS";

export class StageSchedulerRepository {
  public constructor(private readonly database: Database) {}

  public scheduleNext(now: Date): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [stage] = await transaction
        .select()
        .from(runtimeStages)
        .where(
          and(
            eq(runtimeStages.status, "ACTIVE"),
            isNull(runtimeStages.schedulingCompletedAt),
          ),
        )
        .orderBy(asc(runtimeStages.activatedAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!stage?.activatedAt) return false;

      const [source] = await transaction
        .select()
        .from(workflowStages)
        .where(
          and(
            eq(workflowStages.organizationId, stage.organizationId),
            eq(workflowStages.id, stage.sourceWorkflowStageId),
          ),
        );
      if (!source) throw new Error("Runtime stage source is missing");
      const [version] = await transaction
        .select()
        .from(workflowVersions)
        .where(
          and(
            eq(workflowVersions.organizationId, stage.organizationId),
            eq(workflowVersions.id, source.workflowVersionId),
          ),
        );
      if (!version) throw new Error("Runtime workflow version is missing");

      const dueAt =
        source.dueDuration &&
        source.dueDurationUnit &&
        source.businessCalendarId
          ? addBusinessMinutes(
              stage.activatedAt,
              durationMinutes(source.dueDuration, source.dueDurationUnit),
              await loadCalendar(
                transaction,
                stage.organizationId,
                source.businessCalendarId,
              ),
            )
          : null;
      const reminders = await transaction
        .select()
        .from(stageReminderRules)
        .where(
          and(
            eq(stageReminderRules.organizationId, stage.organizationId),
            eq(stageReminderRules.workflowStageId, source.id),
          ),
        );
      const escalations = await transaction
        .select()
        .from(stageEscalationRules)
        .where(
          and(
            eq(stageEscalationRules.organizationId, stage.organizationId),
            eq(stageEscalationRules.workflowStageId, source.id),
          ),
        );
      const calendarId =
        source.businessCalendarId ?? version.businessCalendarId;
      const calendar = await loadCalendar(
        transaction,
        stage.organizationId,
        calendarId,
      );

      for (const rule of reminders) {
        const anchor =
          rule.offsetAnchor === "DUE_TIME" ? dueAt : stage.activatedAt;
        if (!anchor) throw new Error("Reminder due-time anchor is missing");
        await transaction
          .insert(scheduledStageActions)
          .values({
            organizationId: stage.organizationId,
            requestId: stage.requestId,
            runtimeStageId: stage.id,
            sourceRuleId: rule.id,
            deduplicationKey: `reminder:${rule.id}`,
            kind: "REMINDER",
            recipientPolicy: rule.recipientPolicy,
            scheduledFor: addBusinessMinutes(
              anchor,
              durationMinutes(rule.offsetValue, rule.offsetUnit),
              calendar,
            ),
          })
          .onConflictDoNothing();
      }
      for (const rule of escalations) {
        const anchor =
          rule.offsetAnchor === "DUE_TIME" ? dueAt : stage.activatedAt;
        if (!anchor) throw new Error("Escalation due-time anchor is missing");
        await transaction
          .insert(scheduledStageActions)
          .values({
            organizationId: stage.organizationId,
            requestId: stage.requestId,
            runtimeStageId: stage.id,
            sourceRuleId: rule.id,
            deduplicationKey: `escalation:${rule.id}`,
            kind:
              rule.action === "RETURN_TO_INITIATOR"
                ? "ESCALATION_RETURN"
                : "ESCALATION_NOTIFY",
            recipientPolicy: rule.recipientPolicy,
            scheduledFor: addBusinessMinutes(
              anchor,
              durationMinutes(rule.offsetValue, rule.offsetUnit),
              calendar,
            ),
          })
          .onConflictDoNothing();
      }
      if (
        version.automaticApprovalEnabled &&
        version.automaticApprovalDuration &&
        version.automaticApprovalDurationUnit
      )
        await transaction
          .insert(scheduledStageActions)
          .values({
            organizationId: stage.organizationId,
            requestId: stage.requestId,
            runtimeStageId: stage.id,
            deduplicationKey: "automatic-approval",
            kind: "AUTOMATIC_APPROVAL",
            scheduledFor: addBusinessMinutes(
              stage.activatedAt,
              durationMinutes(
                version.automaticApprovalDuration,
                version.automaticApprovalDurationUnit,
              ),
              await loadCalendar(
                transaction,
                stage.organizationId,
                version.businessCalendarId,
              ),
            ),
          })
          .onConflictDoNothing();

      await transaction.insert(outboxEvents).values({
        organizationId: stage.organizationId,
        aggregateType: "RUNTIME_STAGE",
        aggregateId: stage.id,
        eventType: "STAGE_ACTIVATED",
        payload: {
          requestId: stage.requestId,
          runtimeStageId: stage.id,
          dueAt,
        },
      });
      await transaction
        .update(runtimeStages)
        .set({ dueAt, schedulingCompletedAt: now })
        .where(
          and(
            eq(runtimeStages.organizationId, stage.organizationId),
            eq(runtimeStages.id, stage.id),
          ),
        );
      return true;
    });
  }
}

function durationMinutes(value: number, unit: DurationUnit) {
  return value * (unit === "BUSINESS_DAYS" ? 8 * 60 : 60);
}

async function loadCalendar(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  organizationId: string,
  calendarId: string,
): Promise<BusinessCalendar> {
  const [calendar] = await transaction
    .select({ timezone: businessCalendars.timezone })
    .from(businessCalendars)
    .where(
      and(
        eq(businessCalendars.organizationId, organizationId),
        eq(businessCalendars.id, calendarId),
      ),
    );
  if (!calendar) throw new Error("Business calendar is missing");
  const workPeriods = await transaction
    .select({
      weekday: businessCalendarWorkPeriods.weekday,
      start: businessCalendarWorkPeriods.localStartTime,
      end: businessCalendarWorkPeriods.localEndTime,
    })
    .from(businessCalendarWorkPeriods)
    .where(
      and(
        eq(businessCalendarWorkPeriods.organizationId, organizationId),
        eq(businessCalendarWorkPeriods.businessCalendarId, calendarId),
      ),
    )
    .orderBy(
      asc(businessCalendarWorkPeriods.weekday),
      asc(businessCalendarWorkPeriods.localStartTime),
    );
  const holidays = await transaction
    .select({
      localDate: businessCalendarHolidays.localDate,
      isWorkingDayOverride: businessCalendarHolidays.isWorkingDayOverride,
    })
    .from(businessCalendarHolidays)
    .where(
      and(
        eq(businessCalendarHolidays.organizationId, organizationId),
        eq(businessCalendarHolidays.businessCalendarId, calendarId),
      ),
    );
  return { timezone: calendar.timezone, workPeriods, holidays };
}
