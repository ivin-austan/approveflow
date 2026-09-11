import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { TenantRepository } from "../tenant/tenant.types.js";
import { createWorkflowRouter } from "./workflow.routes.js";
import {
  WorkflowService,
  type WorkflowRepository,
} from "./workflow.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workflowId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const repository: WorkflowRepository = {
  list: () => Promise.resolve([]),
  create: () => Promise.resolve(true),
  createDraftVersion: () => Promise.resolve("CREATED"),
  getDraft: () => Promise.resolve(null),
  replaceDraft: () => Promise.resolve("CONFLICT"),
  validateReferences: () => Promise.resolve([]),
  previewAssignments: () => Promise.resolve([]),
  publish: () => Promise.resolve("PUBLISHED"),
};
const tenants: TenantRepository = {
  listActiveOrganizations: () => Promise.resolve([]),
  resolveActiveContext: (_userId, requestedOrganizationId) =>
    Promise.resolve({
      userId: "user",
      organizationId: requestedOrganizationId,
      membershipId: "member",
      permissions: new Set([
        "workflow.read",
        "workflow.edit",
        "workflow.publish",
      ]),
    }),
};
const app = createApp({
  webOrigin: "http://localhost:5173",
  workflowRouter: createWorkflowRouter(
    new WorkflowService(repository),
    { verify: () => Promise.resolve("user") },
    tenants,
  ),
});

describe("workflow routes", () => {
  it("creates a tenant-scoped draft from a published version", async () => {
    const createDraftVersion = () => Promise.resolve("CREATED" as const);
    const versioningApp = createApp({
      webOrigin: "http://localhost:5173",
      workflowRouter: createWorkflowRouter(
        new WorkflowService({
          ...repository,
          createDraftVersion,
          getDraft: () =>
            Promise.resolve({
              workflowId,
              versionId,
              status: "PUBLISHED",
              revision: 1,
              expectedRevision: 1,
              automaticApprovalEnabled: false,
              allowRequesterSelfApproval: false,
              allowNoStageAutomaticApproval: false,
              formSections: [],
              fieldConditions: [],
              stages: [],
            }),
        }),
        { verify: () => Promise.resolve("user") },
        tenants,
      ),
    });
    const response = await request(versioningApp)
      .post(
        `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions`,
      )
      .set("authorization", "Bearer valid")
      .set("x-organization-id", organizationId)
      .send({ sourceVersionId: versionId });
    expect(response.status).toBe(201);
    expect(JSON.parse(response.text) as unknown).toMatchObject({
      data: { revision: 1 },
    });
  });

  it("rejects a URL organization that differs from the active tenant", async () => {
    const response = await request(app)
      .get(
        `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}`,
      )
      .set("authorization", "Bearer valid")
      .set("x-organization-id", "44444444-4444-4444-8444-444444444444");
    expect(response.status).toBe(403);
  });

  it("returns an optimistic concurrency conflict", async () => {
    const response = await request(app)
      .put(
        `/api/v1/organizations/${organizationId}/workflows/${workflowId}/versions/${versionId}`,
      )
      .set("authorization", "Bearer valid")
      .set("x-organization-id", organizationId)
      .send({
        expectedRevision: 1,
        allowRequesterSelfApproval: false,
        allowNoStageAutomaticApproval: false,
        stages: [],
      });
    expect(response.status).toBe(409);
    expect(response.text).toContain('"code":"WORKFLOW_REVISION_CONFLICT"');
  });
});
