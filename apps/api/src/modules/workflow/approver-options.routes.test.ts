import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import type { TenantRepository } from "../tenant/tenant.types.js";
import { createApproverOptionRouter } from "./approver-options.routes.js";
import {
  ApproverOptionService,
  type ApproverOptionRepository,
} from "./approver-options.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const listMemberships = vi.fn(() => Promise.resolve([]));
const repository: ApproverOptionRepository = {
  listMemberships,
  listRoles: () => Promise.resolve([]),
  listDepartments: () => Promise.resolve([]),
};
const tenants: TenantRepository = {
  listActiveOrganizations: () => Promise.resolve([]),
  resolveActiveContext: (_userId, requestedOrganizationId) =>
    Promise.resolve({
      userId: "user",
      organizationId: requestedOrganizationId,
      membershipId: "member",
      permissions: new Set(["workflow.edit"]),
    }),
};
const app = createApp({
  webOrigin: "http://localhost:5173",
  approverOptionRouter: createApproverOptionRouter(
    new ApproverOptionService(repository),
    { verify: () => Promise.resolve("user") },
    tenants,
  ),
});

describe("approver option routes", () => {
  it("scopes selector data to the active organization", async () => {
    const response = await request(app)
      .get(
        `/api/v1/organizations/${organizationId}/approver-options/memberships`,
      )
      .set("authorization", "Bearer valid")
      .set("x-organization-id", organizationId);
    expect(response.status).toBe(200);
    expect(listMemberships).toHaveBeenCalledWith(organizationId);
  });

  it("rejects cross-tenant selector access", async () => {
    const response = await request(app)
      .get(`/api/v1/organizations/${organizationId}/approver-options/roles`)
      .set("authorization", "Bearer valid")
      .set("x-organization-id", "22222222-2222-4222-8222-222222222222");
    expect(response.status).toBe(403);
  });
});
