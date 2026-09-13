import { describe, expect, it } from "vitest";
import {
  canTransitionRequest,
  canTransitionStage,
  canTransitionTask,
} from "./transitions.js";

describe("approval state transitions", () => {
  it("allows only defined lifecycle transitions", () => {
    expect(canTransitionRequest("DRAFT", "IN_REVIEW")).toBe(true);
    expect(canTransitionRequest("APPROVED", "IN_REVIEW")).toBe(false);
    expect(canTransitionStage("PENDING", "ACTIVE")).toBe(true);
    expect(canTransitionTask("SKIPPED", "APPROVED")).toBe(false);
  });
});
