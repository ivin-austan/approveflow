import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createTenantRouter } from "./tenant.routes.js";
import type { AccessTokenVerifier, TenantRepository } from "./tenant.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";

function app(allowed: boolean) {
  const verifier: AccessTokenVerifier = {
    verify: (token) => Promise.resolve(token === "valid" ? "user-1" : null),
  };
  const repository: TenantRepository = {
    listActiveOrganizations: (userId) =>
      Promise.resolve(
        userId === "user-1"
          ? [{ id: organizationId, name: "Acme", slug: "acme" }]
          : [],
      ),
    resolveActiveContext: (userId, selectedOrganizationId) =>
      Promise.resolve(
        allowed &&
          userId === "user-1" &&
          selectedOrganizationId === organizationId
          ? {
              userId,
              organizationId,
              membershipId: "membership-1",
              permissions: new Set(["organization.read"]),
            }
          : null,
      ),
  };
  return createApp({
    webOrigin: "http://localhost:5173",
    tenantRouter: createTenantRouter(verifier, repository),
  });
}

describe("tenant boundary", () => {
  it("requires an access token", async () => {
    await request(app(true)).get("/api/v1/organizations").expect(401);
  });

  it("lists only organizations returned for the authenticated user", async () => {
    const response = await request(app(true))
      .get("/api/v1/organizations")
      .set("authorization", "Bearer valid")
      .expect(200);
    expect(response.text).toContain(organizationId);
    expect(response.text).toContain('"name":"Acme"');
  });

  it("resolves an active membership and permissions", async () => {
    const response = await request(app(true))
      .get("/api/v1/context")
      .set("authorization", "Bearer valid")
      .set("x-organization-id", organizationId)
      .expect(200);
    expect(response.text).toContain(organizationId);
    expect(response.text).toContain('"membershipId":"membership-1"');
    expect(response.text).toContain('"permissions":["organization.read"]');
  });

  it("rejects a selected organization without an active membership", async () => {
    await request(app(false))
      .get("/api/v1/context")
      .set("authorization", "Bearer valid")
      .set("x-organization-id", organizationId)
      .expect(403);
  });
});
