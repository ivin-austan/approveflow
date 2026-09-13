import { describe, expect, it, vi } from "vitest";
import {
  ApprovalCommandError,
  ApprovalService,
  type ApprovalRepository,
} from "./approval.service.js";

function repository(
  result:
    | "DECIDED"
    | "REPLAY"
    | "NOT_FOUND"
    | "STALE"
    | "SELF_APPROVAL_DENIED"
    | "IDEMPOTENCY_MISMATCH" = "DECIDED",
): {
  repo: ApprovalRepository;
  decide: ReturnType<typeof vi.fn<ApprovalRepository["decide"]>>;
} {
  const decide = vi.fn<ApprovalRepository["decide"]>(() =>
    Promise.resolve(result),
  );
  return {
    decide,
    repo: {
      inbox: vi.fn(() => Promise.resolve([])),
      decide,
      reassign: vi.fn(() => Promise.resolve("REASSIGNED" as const)),
    },
  };
}
describe("ApprovalService", () => {
  it("hashes the command for idempotency", async () => {
    const { repo, decide } = repository();
    await new ApprovalService(repo).decide("org", "member", "task", "key", {
      action: "APPROVE",
      comment: null,
      expectedRequestRevision: 2,
    });
    const call = decide.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Decision repository was not called");
    expect(call[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("surfaces stale commands", async () => {
    await expect(
      new ApprovalService(repository("STALE").repo).decide(
        "org",
        "member",
        "task",
        "key",
        { action: "APPROVE", comment: null, expectedRequestRevision: 2 },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ApprovalCommandError>>({ code: "STALE" }),
    );
  });
});
