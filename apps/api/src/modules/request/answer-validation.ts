import type { Condition } from "../workflow/condition.js";
import { evaluateCondition } from "../workflow/condition.js";

export interface RuntimeField {
  readonly id: string;
  readonly type:
    | "SHORT_TEXT"
    | "LONG_TEXT"
    | "NUMBER"
    | "MONEY"
    | "DATE"
    | "BOOLEAN"
    | "SINGLE_SELECT"
    | "MULTI_SELECT"
    | "MEMBER_SELECTOR";
  readonly label: string;
  readonly required: boolean;
  readonly optionValues: readonly string[];
}

export interface RuntimeFieldCondition {
  readonly targetFieldId: string;
  readonly effect: "SHOW" | "HIDE" | "REQUIRE";
  readonly condition: Condition;
}

export interface AnswerIssue {
  readonly fieldId: string;
  readonly code:
    "UNKNOWN_FIELD" | "REQUIRED" | "INVALID_TYPE" | "INVALID_OPTION";
  readonly message: string;
}

export function validateAnswers(
  fields: readonly RuntimeField[],
  conditions: readonly RuntimeFieldCondition[],
  answers: Readonly<Record<string, unknown>>,
): readonly AnswerIssue[] {
  const known = new Map(fields.map((field) => [field.id, field]));
  const issues: AnswerIssue[] = [];
  for (const fieldId of Object.keys(answers)) {
    if (!known.has(fieldId))
      issues.push({
        fieldId,
        code: "UNKNOWN_FIELD",
        message: "Unknown form field.",
      });
  }
  for (const field of fields) {
    const matching = conditions.filter(
      (item) =>
        item.targetFieldId === field.id &&
        evaluateCondition(item.condition, answers) === "MATCHED",
    );
    const hidden = matching.some((item) => item.effect === "HIDE");
    const shown = matching.some((item) => item.effect === "SHOW");
    const hasShowRule = conditions.some(
      (item) => item.targetFieldId === field.id && item.effect === "SHOW",
    );
    const visible = !hidden && (!hasShowRule || shown);
    const required =
      visible &&
      (field.required || matching.some((item) => item.effect === "REQUIRE"));
    const value = answers[field.id];
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (required && empty) {
      issues.push({
        fieldId: field.id,
        code: "REQUIRED",
        message: `${field.label} is required.`,
      });
      continue;
    }
    if (empty || !visible) continue;
    if (!validType(field, value))
      issues.push({
        fieldId: field.id,
        code: "INVALID_TYPE",
        message: `${field.label} has an invalid value.`,
      });
    else if (!validOption(field, value))
      issues.push({
        fieldId: field.id,
        code: "INVALID_OPTION",
        message: `${field.label} contains an invalid option.`,
      });
  }
  return issues;
}

function validType(field: RuntimeField, value: unknown): boolean {
  switch (field.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
    case "DATE":
    case "SINGLE_SELECT":
    case "MEMBER_SELECTOR":
      return typeof value === "string";
    case "NUMBER":
    case "MONEY":
      return typeof value === "number" && Number.isFinite(value);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "MULTI_SELECT":
      return (
        Array.isArray(value) && value.every((item) => typeof item === "string")
      );
  }
}

function validOption(field: RuntimeField, value: unknown): boolean {
  if (field.type === "SINGLE_SELECT")
    return field.optionValues.includes(String(value));
  if (field.type === "MULTI_SELECT")
    return (value as readonly string[]).every((item) =>
      field.optionValues.includes(item),
    );
  return true;
}
