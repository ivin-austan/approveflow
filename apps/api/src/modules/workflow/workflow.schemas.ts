import { z } from "zod";
import { conditionSchema } from "./condition.js";

const id = z.uuid();
const duration = z
  .object({
    value: z.number().int().positive(),
    unit: z.enum(["BUSINESS_HOURS", "BUSINESS_DAYS"]),
  })
  .strict();

export const assignmentSchema = z.discriminatedUnion("assignmentType", [
  z
    .object({
      id,
      assignmentType: z.literal("MEMBERSHIP"),
      membershipId: id.optional(),
      invitationId: id.optional(),
      displayOrder: z.number().int().positive(),
    })
    .strict()
    .refine(
      (value) => Boolean(value.membershipId) !== Boolean(value.invitationId),
      { message: "Provide exactly one membership or invitation reference." },
    ),
  z
    .object({
      id,
      assignmentType: z.literal("ROLE"),
      roleId: id,
      displayOrder: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id,
      assignmentType: z.literal("DEPARTMENT_ROLE"),
      departmentId: id,
      roleId: id,
      displayOrder: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id,
      assignmentType: z.literal("REQUESTER_MANAGER"),
      displayOrder: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      id,
      assignmentType: z.literal("FORM_FIELD_USER"),
      formFieldId: id,
      displayOrder: z.number().int().positive(),
    })
    .strict(),
]);

export const workflowStageSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    instructions: z.string().trim().max(4000).nullable(),
    position: z.number().int().positive(),
    completionPolicy: z.enum(["ANY", "ALL"]),
    dueDuration: duration.nullable(),
    activationCondition: conditionSchema.nullable(),
    approvers: z.array(assignmentSchema).min(1).max(50),
  })
  .strict();

export const replaceDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    allowRequesterSelfApproval: z.boolean(),
    allowNoStageAutomaticApproval: z.boolean(),
    stages: z.array(workflowStageSchema).max(20),
  })
  .strict()
  .superRefine((draft, context) => {
    const positions = draft.stages
      .map((stage) => stage.position)
      .sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index + 1))
      context.addIssue({
        code: "custom",
        path: ["stages"],
        message: "Stage positions must be unique and contiguous.",
      });
    for (const [stageIndex, stage] of draft.stages.entries()) {
      const orders = stage.approvers
        .map((approver) => approver.displayOrder)
        .sort((a, b) => a - b);
      if (orders.some((order, index) => order !== index + 1))
        context.addIssue({
          code: "custom",
          path: ["stages", stageIndex, "approvers"],
          message: "Approver display order must be unique and contiguous.",
        });
    }
  });

export type ReplaceDraft = z.infer<typeof replaceDraftSchema>;
