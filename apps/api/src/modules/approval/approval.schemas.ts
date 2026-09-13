import { z } from "zod";

export const decisionSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT", "RETURN"]),
    comment: z.string().trim().max(2_000).nullable().default(null),
    expectedRequestRevision: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action !== "APPROVE" && !value.comment) {
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "A comment is required for rejection or return.",
      });
    }
  });

export const reassignSchema = z
  .object({
    replacementMembershipId: z.uuid(),
    comment: z.string().trim().min(1).max(2_000),
    expectedRequestRevision: z.number().int().positive(),
  })
  .strict();

export type DecisionInput = z.infer<typeof decisionSchema>;
export type ReassignInput = z.infer<typeof reassignSchema>;
