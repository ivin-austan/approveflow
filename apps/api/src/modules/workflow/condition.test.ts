import { describe, expect, it } from "vitest";
import {
  conditionSchema,
  evaluateCondition,
  type Condition,
} from "./condition.js";

const amountField = "11111111-1111-4111-8111-111111111111";
const regionField = "22222222-2222-4222-8222-222222222222";

describe("workflow condition AST", () => {
  it("evaluates nested conditions without executing user code", () => {
    const condition = conditionSchema.parse({
      kind: "group",
      operator: "all",
      conditions: [
        {
          kind: "comparison",
          fieldId: amountField,
          operator: "gte",
          value: 5000,
        },
        {
          kind: "comparison",
          fieldId: regionField,
          operator: "in",
          value: ["AE", "IN"],
        },
      ],
    });
    expect(
      evaluateCondition(condition, {
        [amountField]: 7500,
        [regionField]: "AE",
      }),
    ).toBe("MATCHED");
    expect(
      evaluateCondition(condition, {
        [amountField]: 1000,
        [regionField]: "AE",
      }),
    ).toBe("NOT_MATCHED");
  });

  it("preserves uncertainty for incomplete preview answers", () => {
    const condition: Condition = {
      kind: "comparison",
      fieldId: amountField,
      operator: "gte",
      value: 5000,
    };
    expect(evaluateCondition(condition, {})).toBe("UNRESOLVED");
  });

  it("rejects unexpected properties and invalid operator values", () => {
    expect(
      conditionSchema.safeParse({
        kind: "comparison",
        fieldId: amountField,
        operator: "in",
        value: "AE",
        source: "process.exit()",
      }).success,
    ).toBe(false);
  });

  it("bounds condition depth", () => {
    let condition: unknown = {
      kind: "isEmpty",
      fieldId: amountField,
      empty: true,
    };
    for (let index = 0; index < 6; index += 1)
      condition = { kind: "not", condition };
    expect(conditionSchema.safeParse(condition).success).toBe(false);
  });
});
