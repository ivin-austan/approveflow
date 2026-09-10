import { describe, expect, it, vi } from "vitest";
import {
  AdministrationReferenceError,
  AdministrationService,
  AdministrationValidationError,
  type AdministrationRepository,
} from "./administration.service.js";

function repository(
  overrides: Partial<AdministrationRepository> = {},
): AdministrationRepository {
  return {
    createDepartment: () => Promise.resolve(),
    createRole: () => Promise.resolve(),
    setMembershipConfiguration: () => Promise.resolve(true),
    createInvitation: () => Promise.resolve(true),
    revokeInvitation: () => Promise.resolve(true),
    ...overrides,
  };
}

describe("AdministrationService", () => {
  it("requires the default department to be assigned", async () => {
    const service = new AdministrationService(repository());
    await expect(
      service.configureMembership("organization-1", "membership-1", {
        reportingManagerMembershipId: null,
        departmentIds: ["department-1"],
        defaultDepartmentId: "department-2",
        roleIds: [],
      }),
    ).rejects.toThrow(AdministrationValidationError);
  });

  it("rejects cross-tenant references reported by the repository", async () => {
    const service = new AdministrationService(
      repository({ setMembershipConfiguration: () => Promise.resolve(false) }),
    );
    await expect(
      service.configureMembership("organization-1", "membership-1", {
        reportingManagerMembershipId: "membership-2",
        departmentIds: ["department-1"],
        defaultDepartmentId: "department-1",
        roleIds: ["role-from-another-tenant"],
      }),
    ).rejects.toThrow(AdministrationReferenceError);
  });

  it("stores only an invitation hash and returns the secret once", async () => {
    const createInvitation = vi.fn<
      AdministrationRepository["createInvitation"]
    >(() => Promise.resolve(true));
    const service = new AdministrationService(
      repository({ createInvitation }),
      () => new Date("2026-09-10T00:00:00.000Z"),
    );
    const result = await service.invite("organization-1", "membership-1", {
      email: " Invitee@Example.com ",
      fullName: "Invitee",
      departmentIds: ["department-1"],
      defaultDepartmentId: "department-1",
      roleIds: [],
    });

    const stored = createInvitation.mock.calls[0]?.[0];
    expect(stored?.email).toBe("invitee@example.com");
    expect(stored?.tokenHash).not.toBe(result.secret);
    expect(result.expiresAt).toEqual(new Date("2026-09-17T00:00:00.000Z"));
  });
});
