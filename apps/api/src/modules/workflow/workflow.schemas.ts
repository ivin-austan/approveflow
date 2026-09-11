import { z } from "zod";
import { conditionSchema } from "./condition.js";

const id = z.uuid();
const duration = z
  .object({
    value: z.number().int().positive(),
    unit: z.enum(["BUSINESS_HOURS", "BUSINESS_DAYS"]),
  })
  .strict();

const recipientPolicy = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STAGE_APPROVERS") }).strict(),
  z
    .object({
      type: z.literal("MEMBERSHIPS"),
      membershipIds: z.array(id).min(1).max(50),
    })
    .strict(),
  z
    .object({ type: z.literal("ROLES"), roleIds: z.array(id).min(1).max(50) })
    .strict(),
]);

const timedRule = z.object({
  id,
  sequence: z.number().int().positive(),
  offset: duration,
  offsetAnchor: z.enum(["ACTIVATION", "DUE_TIME"]),
});
export const reminderRuleSchema = timedRule
  .extend({ recipientPolicy })
  .strict();
export const escalationRuleSchema = z.discriminatedUnion("action", [
  timedRule.extend({ action: z.literal("NOTIFY"), recipientPolicy }).strict(),
  timedRule.extend({ action: z.literal("RETURN_TO_INITIATOR") }).strict(),
]);

export const formFieldSchema = z
  .object({
    id,
    stableKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    type: z.enum([
      "SHORT_TEXT",
      "LONG_TEXT",
      "NUMBER",
      "MONEY",
      "DATE",
      "BOOLEAN",
      "SINGLE_SELECT",
      "MULTI_SELECT",
      "MEMBER_SELECTOR",
    ]),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    required: z.boolean(),
    position: z.number().int().positive(),
    config: z.record(z.string(), z.unknown()),
    options: z
      .array(
        z
          .object({
            id,
            stableValue: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(120),
            position: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const formSectionSchema = z
  .object({
    id,
    stableKey: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
    position: z.number().int().positive(),
    fields: z.array(formFieldSchema).max(100),
  })
  .strict();

export const fieldConditionSchema = z
  .object({
    id,
    targetFormFieldId: id,
    effect: z.enum(["SHOW", "HIDE", "REQUIRE"]),
    condition: conditionSchema,
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
    businessCalendarId: id.nullable().default(null),
    activationCondition: conditionSchema.nullable(),
    approvers: z.array(assignmentSchema).min(1).max(50),
    reminders: z.array(reminderRuleSchema).max(20).default([]),
    escalations: z.array(escalationRuleSchema).max(20).default([]),
  })
  .strict()
  .superRefine((stage, context) => {
    if (
      !stage.dueDuration &&
      (stage.reminders.length > 0 || stage.escalations.length > 0)
    )
      context.addIssue({
        code: "custom",
        path: ["dueDuration"],
        message:
          "A due duration is required when reminders or escalations are configured.",
      });
  });

export const replaceDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    allowRequesterSelfApproval: z.boolean(),
    allowNoStageAutomaticApproval: z.boolean(),
    formSections: z.array(formSectionSchema).max(20).default([]),
    fieldConditions: z.array(fieldConditionSchema).max(200).default([]),
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
      for (const [key, values] of [
        ["reminders", stage.reminders],
        ["escalations", stage.escalations],
      ] as const) {
        if (values.some((rule, index) => rule.sequence !== index + 1))
          context.addIssue({
            code: "custom",
            path: ["stages", stageIndex, key],
            message: `${key} must have contiguous sequence numbers.`,
          });
      }
      const assignmentKeys = stage.approvers.map((item) =>
        JSON.stringify({
          assignmentType: item.assignmentType,
          membershipId: "membershipId" in item ? item.membershipId : null,
          invitationId: "invitationId" in item ? item.invitationId : null,
          roleId: "roleId" in item ? item.roleId : null,
          departmentId: "departmentId" in item ? item.departmentId : null,
          formFieldId: "formFieldId" in item ? item.formFieldId : null,
        }),
      );
      if (new Set(assignmentKeys).size !== assignmentKeys.length)
        context.addIssue({
          code: "custom",
          path: ["stages", stageIndex, "approvers"],
          message: "Duplicate approver assignments are not allowed.",
        });
    }
    if (
      draft.formSections.some(
        (section, index) => section.position !== index + 1,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["formSections"],
        message: "Form section positions must be contiguous.",
      });
    for (const [sectionIndex, section] of draft.formSections.entries()) {
      if (section.fields.some((field, index) => field.position !== index + 1))
        context.addIssue({
          code: "custom",
          path: ["formSections", sectionIndex, "fields"],
          message: "Form field positions must be contiguous.",
        });
      for (const [fieldIndex, field] of section.fields.entries()) {
        const isSelect =
          field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT";
        if (isSelect !== field.options.length > 0)
          context.addIssue({
            code: "custom",
            path: [
              "formSections",
              sectionIndex,
              "fields",
              fieldIndex,
              "options",
            ],
            message: isSelect
              ? "Select fields require at least one option."
              : "Only select fields may define options.",
          });
      }
    }
  });

export type ReplaceDraft = z.infer<typeof replaceDraftSchema>;

export const createWorkflowSchema = z
  .object({
    documentTypeId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullable(),
  })
  .strict();
export type CreateWorkflow = z.infer<typeof createWorkflowSchema>;
