import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./session";

describe("safeReturnPath", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  it("allows only known same-origin authenticated routes", () => {
    expect(
      safeReturnPath(
        `/organizations/${organizationId}/approvals?requestId=22222222-2222-4222-8222-222222222222`,
      ),
    ).toContain("/approvals?");
    expect(
      safeReturnPath(
        `/organizations/${organizationId}/requests/22222222-2222-4222-8222-222222222222`,
      ),
    ).toContain("/requests/");
  });
  it("rejects external, protocol-relative, and unknown paths", () => {
    expect(safeReturnPath("https://evil.example/steal")).toBe("/");
    expect(safeReturnPath("//evil.example/steal")).toBe("/");
    expect(safeReturnPath("/admin/secrets")).toBe("/");
  });
});
