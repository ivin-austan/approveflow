import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  businessCalendarHolidays,
  businessCalendarWorkPeriods,
  businessCalendars,
  documentTypes,
  documentTypeRecipients,
  memberships,
  schema as databaseSchema,
} from "@approveflow/database";
import type { WorkflowConfigurationRepository } from "./configuration.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;

export class DrizzleWorkflowConfigurationRepository implements WorkflowConfigurationRepository {
  public constructor(private readonly database: Database) {}

  public listBusinessCalendars(organizationId: string) {
    return this.database
      .select({
        id: businessCalendars.id,
        name: businessCalendars.name,
        timezone: businessCalendars.timezone,
        revision: businessCalendars.revision,
        isDefault: businessCalendars.isDefault,
        status: businessCalendars.status,
      })
      .from(businessCalendars)
      .where(eq(businessCalendars.organizationId, organizationId))
      .orderBy(asc(businessCalendars.name));
  }

  public listDocumentTypes(organizationId: string) {
    return this.database
      .select({
        id: documentTypes.id,
        name: documentTypes.name,
        code: documentTypes.code,
        status: documentTypes.status,
        businessCalendarId: documentTypes.businessCalendarId,
        numberFormat: documentTypes.numberFormat,
        sequencePadding: documentTypes.sequencePadding,
      })
      .from(documentTypes)
      .where(eq(documentTypes.organizationId, organizationId))
      .orderBy(asc(documentTypes.name));
  }

  public saveBusinessCalendar(
    input: Parameters<
      WorkflowConfigurationRepository["saveBusinessCalendar"]
    >[0],
  ): Promise<"SAVED" | "CONFLICT"> {
    return this.database.transaction(async (transaction) => {
      let calendarId = input.id;
      if (input.expectedRevision) {
        const [existing] = await transaction
          .select({ id: businessCalendars.id })
          .from(businessCalendars)
          .where(
            and(
              eq(businessCalendars.organizationId, input.organizationId),
              eq(businessCalendars.id, input.id),
              eq(businessCalendars.revision, input.expectedRevision),
              eq(businessCalendars.status, "ACTIVE"),
            ),
          )
          .for("update");
        if (!existing) return "CONFLICT";
      }
      if (input.isDefault)
        await transaction
          .update(businessCalendars)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(businessCalendars.organizationId, input.organizationId),
              sql`${businessCalendars.id} <> ${calendarId}`,
              eq(businessCalendars.isDefault, true),
            ),
          );
      if (input.expectedRevision) {
        const [updated] = await transaction
          .update(businessCalendars)
          .set({
            name: input.name,
            timezone: input.timezone,
            isDefault: input.isDefault,
            revision: sql`${businessCalendars.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(businessCalendars.organizationId, input.organizationId),
              eq(businessCalendars.id, input.id),
              eq(businessCalendars.revision, input.expectedRevision),
              eq(businessCalendars.status, "ACTIVE"),
            ),
          )
          .returning({ id: businessCalendars.id });
        if (!updated) return "CONFLICT";
        calendarId = updated.id;
        await transaction
          .delete(businessCalendarWorkPeriods)
          .where(
            and(
              eq(
                businessCalendarWorkPeriods.organizationId,
                input.organizationId,
              ),
              eq(businessCalendarWorkPeriods.businessCalendarId, calendarId),
            ),
          );
        await transaction
          .delete(businessCalendarHolidays)
          .where(
            and(
              eq(businessCalendarHolidays.organizationId, input.organizationId),
              eq(businessCalendarHolidays.businessCalendarId, calendarId),
            ),
          );
      } else {
        await transaction.insert(businessCalendars).values({
          id: calendarId,
          organizationId: input.organizationId,
          name: input.name,
          timezone: input.timezone,
          isDefault: input.isDefault,
        });
      }
      await transaction.insert(businessCalendarWorkPeriods).values(
        input.workPeriods.map((period) => ({
          organizationId: input.organizationId,
          businessCalendarId: calendarId,
          ...period,
        })),
      );
      if (input.holidays.length > 0)
        await transaction.insert(businessCalendarHolidays).values(
          input.holidays.map((holiday) => ({
            organizationId: input.organizationId,
            businessCalendarId: calendarId,
            ...holiday,
          })),
        );
      return "SAVED";
    });
  }

  public createDocumentType(
    input: Parameters<WorkflowConfigurationRepository["createDocumentType"]>[0],
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [calendar] = await transaction
        .select({ id: businessCalendars.id })
        .from(businessCalendars)
        .where(
          and(
            eq(businessCalendars.organizationId, input.organizationId),
            eq(businessCalendars.id, input.businessCalendarId),
            eq(businessCalendars.status, "ACTIVE"),
          ),
        );
      if (!calendar) return false;
      const recipientIds = [...new Set(input.finalRecipientMembershipIds)];
      if (recipientIds.length > 0) {
        const recipients = await transaction
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, input.organizationId),
              inArray(memberships.id, recipientIds),
              eq(memberships.status, "ACTIVE"),
            ),
          );
        if (recipients.length !== recipientIds.length) return false;
      }
      await transaction.insert(documentTypes).values({
        id: input.id,
        organizationId: input.organizationId,
        name: input.name,
        code: input.code,
        businessCalendarId: input.businessCalendarId,
        numberFormat: input.numberFormat,
        sequencePadding: input.sequencePadding,
        approvedPdfRetentionYears: input.approvedPdfRetentionYears,
        approvedPdfFieldPolicy: input.approvedPdfFieldPolicy,
        automaticApprovalEnabled: input.automaticApprovalEnabled,
        automaticApprovalDuration: input.automaticApprovalDuration,
        automaticApprovalDurationUnit: input.automaticApprovalDurationUnit,
      });
      if (recipientIds.length > 0)
        await transaction.insert(documentTypeRecipients).values(
          recipientIds.map((membershipId) => ({
            organizationId: input.organizationId,
            documentTypeId: input.id,
            membershipId,
          })),
        );
      return true;
    });
  }
}
