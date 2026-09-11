export interface ApproverMembershipOption {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: "ACTIVE" | "SUSPENDED";
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly departments: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

export interface ApproverOptionRepository {
  listMemberships(
    organizationId: string,
  ): Promise<readonly ApproverMembershipOption[]>;
  listRoles(organizationId: string): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly status: "ACTIVE" | "ARCHIVED";
    }[]
  >;
  listDepartments(organizationId: string): Promise<
    readonly {
      readonly id: string;
      readonly name: string;
      readonly status: "ACTIVE" | "ARCHIVED";
    }[]
  >;
}

export class ApproverOptionService {
  public constructor(private readonly repository: ApproverOptionRepository) {}
  public listMemberships(organizationId: string) {
    return this.repository.listMemberships(organizationId);
  }
  public listRoles(organizationId: string) {
    return this.repository.listRoles(organizationId);
  }
  public listDepartments(organizationId: string) {
    return this.repository.listDepartments(organizationId);
  }
}
