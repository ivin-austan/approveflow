import { describe, expect, it } from "vitest";
import { validateAnswers, type RuntimeField } from "./answer-validation.js";

const field = (overrides: Partial<RuntimeField> = {}): RuntimeField => ({
  id: "00000000-0000-4000-8000-000000000001",
  type: "SHORT_TEXT",
  label: "Purpose",
  required: true,
  optionValues: [],
  ...overrides,
});

describe("validateAnswers", () => {
  it("rejects missing required values and unknown fields", () => {
    expect(
      validateAnswers([field()], [], {
        "00000000-0000-4000-8000-000000000099": "x",
      }),
    ).toEqual([
      expect.objectContaining({ code: "UNKNOWN_FIELD" }),
      expect.objectContaining({ code: "REQUIRED" }),
    ]);
  });

  it("applies conditional visibility and required rules", () => {
    const trigger = field({
      id: "00000000-0000-4000-8000-000000000002",
      required: false,
    });
    const target = field();
    const condition = {
      targetFieldId: target.id,
      effect: "SHOW" as const,
      condition: {
        kind: "comparison" as const,
        fieldId: trigger.id,
        operator: "eq" as const,
        value: "yes",
      },
    };
    expect(
      validateAnswers([trigger, target], [condition], { [trigger.id]: "no" }),
    ).toEqual([]);
    expect(
      validateAnswers([trigger, target], [condition], { [trigger.id]: "yes" }),
    ).toEqual([
      expect.objectContaining({ fieldId: target.id, code: "REQUIRED" }),
    ]);
  });

  it("validates select options and numeric types", () => {
    const choice = field({
      type: "SINGLE_SELECT",
      optionValues: ["travel", "software"],
    });
    expect(
      validateAnswers([choice], [], { [choice.id]: "other" })[0]?.code,
    ).toBe("INVALID_OPTION");
    const amount = field({ type: "MONEY" });
    expect(validateAnswers([amount], [], { [amount.id]: "100" })[0]?.code).toBe(
      "INVALID_TYPE",
    );
  });
});
