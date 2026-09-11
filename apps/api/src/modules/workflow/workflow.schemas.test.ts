import { describe, expect, it } from "vitest";
import { assignmentSchema, replaceDraftSchema } from "./workflow.schemas.js";

const id = (digit: number) =>
  `${String(digit)}1111111-1111-4111-8111-111111111111`;

describe("workflow draft schemas", () => {
  it("accepts arbitrary contiguous stage names and ANY/ALL policies", () => {
    const result = replaceDraftSchema.safeParse({
      expectedRevision: 2,
      allowRequesterSelfApproval: false,
      allowNoStageAutomaticApproval: false,
      stages: [
        {
          id: id(1),
          name: "Project Review",
          description: null,
          instructions: null,
          position: 1,
          completionPolicy: "ANY",
          dueDuration: null,
          activationCondition: null,
          approvers: [
            { id: id(2), assignmentType: "REQUESTER_MANAGER", displayOrder: 1 },
          ],
        },
        {
          id: id(3),
          name: "Custom Final Check",
          description: null,
          instructions: null,
          position: 2,
          completionPolicy: "ALL",
          dueDuration: { value: 2, unit: "BUSINESS_DAYS" },
          activationCondition: null,
          approvers: [
            {
              id: id(4),
              assignmentType: "ROLE",
              roleId: id(5),
              displayOrder: 1,
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects gaps and duplicate positions", () => {
    const stage = (stageId: string, position: number) => ({
      id: stageId,
      name: "Review",
      description: null,
      instructions: null,
      position,
      completionPolicy: "ANY",
      dueDuration: null,
      activationCondition: null,
      approvers: [
        { id: id(4), assignmentType: "REQUESTER_MANAGER", displayOrder: 1 },
      ],
    });
    expect(
      replaceDraftSchema.safeParse({
        expectedRevision: 1,
        allowRequesterSelfApproval: false,
        allowNoStageAutomaticApproval: false,
        stages: [stage(id(1), 1), stage(id(2), 3)],
      }).success,
    ).toBe(false);
  });

  it("enforces assignment discriminants and rejects extra references", () => {
    expect(
      assignmentSchema.safeParse({
        id: id(1),
        assignmentType: "ROLE",
        roleId: id(2),
        membershipId: id(3),
        displayOrder: 1,
      }).success,
    ).toBe(false);
    expect(
      assignmentSchema.safeParse({
        id: id(1),
        assignmentType: "MEMBERSHIP",
        membershipId: id(2),
        invitationId: id(3),
        displayOrder: 1,
      }).success,
    ).toBe(false);
  });
});
