import { describe, expect, it } from "vitest";
import { decisionSchema } from "./approval.schemas.js";

describe("decisionSchema", () => {
  it("requires comments for reject and return", () => {
    expect(
      decisionSchema.safeParse({
        action: "REJECT",
        comment: null,
        expectedRequestRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      decisionSchema.safeParse({
        action: "RETURN",
        comment: "Please revise",
        expectedRequestRevision: 1,
      }).success,
    ).toBe(true);
  });
  it("allows approval without a comment", () => {
    expect(
      decisionSchema.safeParse({
        action: "APPROVE",
        expectedRequestRevision: 1,
      }).success,
    ).toBe(true);
  });
});
