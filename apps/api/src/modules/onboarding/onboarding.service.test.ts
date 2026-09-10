import { describe, expect, it, vi } from "vitest";
import { OnboardingService } from "./onboarding.service.js";
import type { OnboardingInput } from "./onboarding.types.js";

describe("OnboardingService", () => {
  it("normalizes identity and creates an initial tenant boundary", async () => {
    let captured: OnboardingInput | undefined;
    const createOrganizationAccount = vi.fn((input: OnboardingInput) => {
      captured = input;
      return Promise.resolve({
        userId: input.userId,
        organizationId: input.organizationId,
        membershipId: input.membershipId,
      });
    });
    const service = new OnboardingService(
      { createOrganizationAccount },
      { hash: () => Promise.resolve("argon-hash") },
    );

    await service.createOrganizationAccount({
      email: " Owner@Example.com ",
      password: "SecurePassword1",
      fullName: " Owner Name ",
      organizationName: " Acme Ltd ",
      organizationSlug: " ACME-LTD ",
    });

    expect(captured).toMatchObject({
      email: "owner@example.com",
      passwordHash: "argon-hash",
      fullName: "Owner Name",
      organizationName: "Acme Ltd",
      organizationSlug: "acme-ltd",
    });
    expect(captured?.permissionKeys).toContain("membership.manage");
  });
});
