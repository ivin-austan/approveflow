import { randomUUID } from "node:crypto";
import type {
  OnboardingRepository,
  OnboardingResult,
  PasswordHasher,
} from "./onboarding.types.js";

export const administratorPermissions = [
  "organization.read",
  "organization.manage",
  "department.read",
  "department.manage",
  "membership.read",
  "membership.manage",
  "role.read",
  "role.manage",
  "workflow.read",
  "workflow.create",
  "workflow.edit",
  "workflow.publish",
  "workflow.archive",
  "request.create",
  "request.read_own",
  "request.read_department",
  "request.read_all",
  "request.cancel_own",
  "request.export",
  "approval.read_assigned",
  "approval.decide",
  "approval.reassign",
  "approved_pdf.read",
  "approved_pdf.retry",
  "audit.read",
] as const;

export class OnboardingConflictError extends Error {}

export class OnboardingService {
  public constructor(
    private readonly repository: OnboardingRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  public async createOrganizationAccount(input: {
    readonly email: string;
    readonly password: string;
    readonly fullName: string;
    readonly organizationName: string;
    readonly organizationSlug: string;
  }): Promise<OnboardingResult> {
    const normalizedSlug = input.organizationSlug.trim().toLowerCase();
    try {
      return await this.repository.createOrganizationAccount({
        userId: randomUUID(),
        email: input.email.trim().toLowerCase(),
        fullName: input.fullName.trim(),
        passwordHash: await this.passwordHasher.hash(input.password),
        organizationId: randomUUID(),
        organizationName: input.organizationName.trim(),
        organizationSlug: normalizedSlug,
        membershipId: randomUUID(),
        roleId: randomUUID(),
        departmentId: randomUUID(),
        permissionKeys: administratorPermissions,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OnboardingConflictError(
          "Account or organization already exists",
        );
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return error.code === "23505";
}
