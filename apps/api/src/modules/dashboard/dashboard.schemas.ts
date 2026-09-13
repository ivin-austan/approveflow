import { z } from "zod";

export const dashboardQuerySchema = z
  .object({
    status: z
      .enum([
        "DRAFT",
        "IN_REVIEW",
        "APPROVED",
        "REJECTED",
        "RETURNED",
        "CANCELLED",
      ])
      .optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(["updatedAt", "requestNumber", "title"]).default("updatedAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    cursor: z.string().max(1_000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
