import { describe, expect, it, vi } from "vitest";
import { AuditService, sanitizePayload } from "./audit.service.js";

describe("audit timeline", () => {
  it("removes sensitive keys recursively", () => {
    expect(
      sanitizePayload({
        artifactId: "artifact",
        email: "secret@example.com",
        nested: { accessToken: "secret", decision: "APPROVED" },
      }),
    ).toEqual({ artifactId: "artifact", nested: { decision: "APPROVED" } });
  });

  it("passes explicit row-access capabilities to the repository", async () => {
    const timeline = vi.fn().mockResolvedValue({
      request: {
        id: "request",
        requestNumber: null,
        title: "Travel",
        status: "DRAFT",
        revision: 1,
      },
      stages: [],
      events: [],
    });
    const service = new AuditService({ timeline });
    await service.timeline("org", "request", "member", false, true);
    expect(timeline).toHaveBeenCalledWith({
      organizationId: "org",
      requestId: "request",
      membershipId: "member",
      canReadAll: false,
      canReadAssigned: true,
    });
  });
});
