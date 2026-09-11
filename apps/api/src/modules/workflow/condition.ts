import { z } from "zod";

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const comparisonOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
]);

export type Condition =
  | {
      readonly kind: "comparison";
      readonly fieldId: string;
      readonly operator: z.infer<typeof comparisonOperatorSchema>;
      readonly value:
        z.infer<typeof scalarSchema> | readonly z.infer<typeof scalarSchema>[];
    }
  | {
      readonly kind: "isEmpty";
      readonly fieldId: string;
      readonly empty: boolean;
    }
  | {
      readonly kind: "group";
      readonly operator: "all" | "any";
      readonly conditions: readonly Condition[];
    }
  | { readonly kind: "not"; readonly condition: Condition };

const conditionNodeSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("comparison"),
        fieldId: z.uuid(),
        operator: comparisonOperatorSchema,
        value: z.union([scalarSchema, z.array(scalarSchema).min(1).max(100)]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("isEmpty"),
        fieldId: z.uuid(),
        empty: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("group"),
        operator: z.enum(["all", "any"]),
        conditions: z.array(conditionNodeSchema).min(1).max(20),
      })
      .strict(),
    z
      .object({
        kind: z.literal("not"),
        condition: conditionNodeSchema,
      })
      .strict(),
  ]),
);

export const conditionSchema = conditionNodeSchema.superRefine(
  (condition, context) => {
    const limits = measure(condition);
    if (limits.depth > 5) {
      context.addIssue({
        code: "custom",
        message: "Condition depth must not exceed 5.",
      });
    }
    if (limits.nodes > 100) {
      context.addIssue({
        code: "custom",
        message: "Condition must not exceed 100 nodes.",
      });
    }
    visitComparisons(condition, (comparison) => {
      if (comparison.operator === "in" && !Array.isArray(comparison.value)) {
        context.addIssue({
          code: "custom",
          message: "The in operator requires an array value.",
        });
      }
      if (comparison.operator !== "in" && Array.isArray(comparison.value)) {
        context.addIssue({
          code: "custom",
          message: `The ${comparison.operator} operator requires a scalar value.`,
        });
      }
    });
  },
);

export type ConditionResult = "MATCHED" | "NOT_MATCHED" | "UNRESOLVED";
export type ConditionAnswers = Readonly<Record<string, unknown>>;

export function evaluateCondition(
  condition: Condition,
  answers: ConditionAnswers,
): ConditionResult {
  switch (condition.kind) {
    case "comparison": {
      if (!Object.hasOwn(answers, condition.fieldId)) return "UNRESOLVED";
      return compare(
        answers[condition.fieldId],
        condition.operator,
        condition.value,
      )
        ? "MATCHED"
        : "NOT_MATCHED";
    }
    case "isEmpty": {
      if (!Object.hasOwn(answers, condition.fieldId)) return "UNRESOLVED";
      const value = answers[condition.fieldId];
      const empty =
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      return empty === condition.empty ? "MATCHED" : "NOT_MATCHED";
    }
    case "not": {
      const result = evaluateCondition(condition.condition, answers);
      return result === "UNRESOLVED"
        ? result
        : result === "MATCHED"
          ? "NOT_MATCHED"
          : "MATCHED";
    }
    case "group": {
      const results = condition.conditions.map((child) =>
        evaluateCondition(child, answers),
      );
      if (condition.operator === "all") {
        if (results.includes("NOT_MATCHED")) return "NOT_MATCHED";
        return results.includes("UNRESOLVED") ? "UNRESOLVED" : "MATCHED";
      }
      if (results.includes("MATCHED")) return "MATCHED";
      return results.includes("UNRESOLVED") ? "UNRESOLVED" : "NOT_MATCHED";
    }
  }
}

function compare(
  left: unknown,
  operator: z.infer<typeof comparisonOperatorSchema>,
  right: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return (
        typeof left === "number" && typeof right === "number" && left > right
      );
    case "gte":
      return (
        typeof left === "number" && typeof right === "number" && left >= right
      );
    case "lt":
      return (
        typeof left === "number" && typeof right === "number" && left < right
      );
    case "lte":
      return (
        typeof left === "number" && typeof right === "number" && left <= right
      );
    case "contains":
      return (
        (typeof left === "string" &&
          typeof right === "string" &&
          left.includes(right)) ||
        (Array.isArray(left) && left.includes(right))
      );
    case "in":
      return Array.isArray(right) && right.includes(left);
  }
}

function measure(condition: Condition): {
  readonly depth: number;
  readonly nodes: number;
} {
  const children =
    condition.kind === "group"
      ? condition.conditions
      : condition.kind === "not"
        ? [condition.condition]
        : [];
  const measured = children.map(measure);
  return {
    depth: 1 + Math.max(0, ...measured.map((item) => item.depth)),
    nodes: 1 + measured.reduce((sum, item) => sum + item.nodes, 0),
  };
}

function visitComparisons(
  condition: Condition,
  visitor: (condition: Extract<Condition, { kind: "comparison" }>) => void,
): void {
  if (condition.kind === "comparison") visitor(condition);
  else if (condition.kind === "group")
    condition.conditions.forEach((child) => {
      visitComparisons(child, visitor);
    });
  else if (condition.kind === "not")
    visitComparisons(condition.condition, visitor);
}
