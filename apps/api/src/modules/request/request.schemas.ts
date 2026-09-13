import { z } from "zod";

export const answersSchema = z.record(z.uuid(), z.unknown());

export const createDraftSchema = z
  .object({
    workflowId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    answers: answersSchema.default({}),
  })
  .strict();

export const updateDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    answers: answersSchema,
  })
  .strict();

export const submitRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    originatingDepartmentId: z.uuid(),
  })
  .strict();

export const resubmitRequestSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();

export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
export type SubmitRequestInput = z.infer<typeof submitRequestSchema>;
export type ResubmitRequestInput = z.infer<typeof resubmitRequestSchema>;
