export interface OnboardingInput {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly departmentId: string;
  readonly permissionKeys: readonly string[];
}

export interface OnboardingResult {
  readonly userId: string;
  readonly organizationId: string;
  readonly membershipId: string;
}

export interface OnboardingRepository {
  createOrganizationAccount(input: OnboardingInput): Promise<OnboardingResult>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
}
