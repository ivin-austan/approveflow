export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface TenantContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly permissions: ReadonlySet<string>;
}

export interface TenantRepository {
  listActiveOrganizations(
    userId: string,
  ): Promise<readonly OrganizationSummary[]>;
  resolveActiveContext(
    userId: string,
    organizationId: string,
  ): Promise<TenantContext | null>;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<string | null>;
}
