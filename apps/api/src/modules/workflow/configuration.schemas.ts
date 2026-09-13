import { z } from "zod";

const durationSchema = z
  .object({
    value: z.number().int().positive().max(10_000),
    unit: z.enum(["BUSINESS_HOURS", "BUSINESS_DAYS"]),
  })
  .strict();

export const workPeriodSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    localStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    localEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict()
  .refine((period) => period.localStartTime < period.localEndTime, {
    message: "Work period start must be before its end.",
  });

export const holidaySchema = z
  .object({
    localDate: z.iso.date(),
    name: z.string().trim().min(1).max(120),
    isWorkingDayOverride: z.boolean(),
  })
  .strict();

export const businessCalendarInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(100),
    isDefault: z.boolean(),
    expectedRevision: z.number().int().positive().optional(),
    workPeriods: z.array(workPeriodSchema).min(1).max(50),
    holidays: z.array(holidaySchema).max(500),
  })
  .strict();

export const documentTypeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_-]+$/),
    businessCalendarId: z.uuid(),
    numberFormat: z.string().trim().min(1).max(200),
    sequencePadding: z.number().int().min(1).max(12),
    approvedPdfRetentionYears: z.number().int().min(1).max(25),
    approvedPdfFieldPolicy: z
      .object({
        includeAllSubmittedFields: z.boolean(),
        excludedFieldIds: z.array(z.uuid()).max(200),
      })
      .strict(),
    finalRecipientMembershipIds: z.array(z.uuid()).max(50).default([]),
    automaticApproval: z.discriminatedUnion("enabled", [
      z.object({ enabled: z.literal(false) }).strict(),
      z.object({ enabled: z.literal(true), after: durationSchema }).strict(),
    ]),
  })
  .strict();

export type BusinessCalendarInput = z.infer<typeof businessCalendarInputSchema>;
export type DocumentTypeInput = z.infer<typeof documentTypeInputSchema>;
