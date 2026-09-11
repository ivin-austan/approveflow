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

  it("validates secure member fields and business-time rules", () => {
    const result = replaceDraftSchema.safeParse({
      expectedRevision: 1,
      allowRequesterSelfApproval: false,
      allowNoStageAutomaticApproval: false,
      formSections: [
        {
          id: id(1),
          stableKey: "request",
          name: "Request",
          description: null,
          position: 1,
          fields: [
            {
              id: id(2),
              stableKey: "delegate",
              type: "MEMBER_SELECTOR",
              label: "Delegate",
              description: null,
              required: true,
              position: 1,
              config: {},
              options: [],
            },
          ],
        },
      ],
      fieldConditions: [],
      stages: [
        {
          id: id(3),
          name: "Dynamic reviewer",
          description: null,
          instructions: null,
          position: 1,
          completionPolicy: "ALL",
          dueDuration: { value: 8, unit: "BUSINESS_HOURS" },
          businessCalendarId: id(4),
          activationCondition: null,
          approvers: [
            {
              id: id(5),
              assignmentType: "FORM_FIELD_USER",
              formFieldId: id(2),
              displayOrder: 1,
            },
          ],
          reminders: [
            {
              id: id(6),
              sequence: 1,
              offset: { value: 4, unit: "BUSINESS_HOURS" },
              offsetAnchor: "ACTIVATION",
              recipientPolicy: { type: "STAGE_APPROVERS" },
            },
          ],
          escalations: [
            {
              id: id(7),
              sequence: 1,
              offset: { value: 1, unit: "BUSINESS_HOURS" },
              offsetAnchor: "DUE_TIME",
              action: "RETURN_TO_INITIATOR",
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects timing rules without a due duration", () => {
    const result = replaceDraftSchema.safeParse({
      expectedRevision: 1,
      allowRequesterSelfApproval: false,
      allowNoStageAutomaticApproval: false,
      stages: [
        {
          id: id(1),
          name: "Review",
          description: null,
          instructions: null,
          position: 1,
          completionPolicy: "ANY",
          dueDuration: null,
          activationCondition: null,
          approvers: [
            { id: id(2), assignmentType: "REQUESTER_MANAGER", displayOrder: 1 },
          ],
          reminders: [
            {
              id: id(3),
              sequence: 1,
              offset: { value: 1, unit: "BUSINESS_HOURS" },
              offsetAnchor: "ACTIVATION",
              recipientPolicy: { type: "STAGE_APPROVERS" },
            },
          ],
          escalations: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
