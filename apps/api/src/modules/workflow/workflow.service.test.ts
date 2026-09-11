import { describe, expect, it, vi } from "vitest";
import {
  WorkflowRevisionConflictError,
  PublishedWorkflowImmutableError,
  WorkflowService,
  type StoredDraft,
  type WorkflowRepository,
} from "./workflow.service.js";

const draft: StoredDraft = {
  workflowId: "w",
  versionId: "v",
  revision: 2,
  expectedRevision: 2,
  automaticApprovalEnabled: false,
  allowRequesterSelfApproval: false,
  allowNoStageAutomaticApproval: false,
  formSections: [],
  fieldConditions: [],
  stages: [],
};
const repository = (
  overrides: Partial<WorkflowRepository> = {},
): WorkflowRepository => ({
  list: () => Promise.resolve([]),
  create: () => Promise.resolve(true),
  getDraft: () => Promise.resolve(draft),
  replaceDraft: () => Promise.resolve("UPDATED"),
  validateReferences: () => Promise.resolve([]),
  previewAssignments: () => Promise.resolve([]),
  publish: () => Promise.resolve("PUBLISHED"),
  ...overrides,
});

describe("WorkflowService", () => {
  it("reports entity-addressable validation issues", async () => {
    const result = await new WorkflowService(repository()).validate(
      "o",
      "w",
      "v",
    );
    expect(result).toMatchObject({
      valid: false,
      issues: [{ code: "STAGE_REQUIRED", entityId: "w", path: "stages" }],
    });
  });

  it("derives the final applicable preview stage", async () => {
    const amount = "11111111-1111-4111-8111-111111111111";
    const getDraft = vi.fn(() =>
      Promise.resolve({
        ...draft,
        stages: [
          {
            id: "s1",
            name: "Manager",
            description: null,
            instructions: null,
            position: 1,
            completionPolicy: "ANY" as const,
            dueDuration: null,
            businessCalendarId: null,
            activationCondition: null,
            approvers: [],
            reminders: [],
            escalations: [],
          },
          {
            id: "s2",
            name: "Finance",
            description: null,
            instructions: null,
            position: 2,
            completionPolicy: "ANY" as const,
            dueDuration: null,
            businessCalendarId: null,
            activationCondition: {
              kind: "comparison" as const,
              fieldId: amount,
              operator: "gte" as const,
              value: 5000,
            },
            approvers: [],
            reminders: [],
            escalations: [],
          },
        ],
      }),
    );
    const result = await new WorkflowService(repository({ getDraft })).preview(
      "o",
      "w",
      "v",
      { [amount]: 7000 },
    );
    expect(result.finalStageId).toBe("s2");
  });

  it("surfaces optimistic revision conflicts", async () => {
    const service = new WorkflowService(
      repository({ replaceDraft: () => Promise.resolve("CONFLICT") }),
    );
    await expect(
      service.replaceDraft("o", "w", "v", draft),
    ).rejects.toBeInstanceOf(WorkflowRevisionConflictError);
  });

  it("rejects mutation of a published workflow version", async () => {
    const service = new WorkflowService(
      repository({ replaceDraft: () => Promise.resolve("IMMUTABLE") }),
    );
    await expect(
      service.replaceDraft("o", "w", "v", draft),
    ).rejects.toBeInstanceOf(PublishedWorkflowImmutableError);
  });
});
