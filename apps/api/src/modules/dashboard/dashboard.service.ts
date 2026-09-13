import type { DashboardQuery } from "./dashboard.schemas.js";

export type DashboardScope = "ALL" | "DEPARTMENT" | "OWN" | "ASSIGNED";
export interface DashboardRow {
  id: string;
  requestNumber: string | null;
  title: string;
  status: string;
  requesterMembershipId: string;
  departmentName: string | null;
  currentStage: string | null;
  artifactId: string | null;
  artifactStatus: string | null;
  legalHold: boolean | null;
  deliveryId: string | null;
  deliveryStatus: string | null;
  updatedAt: Date;
}
export interface DashboardResult {
  rows: readonly DashboardRow[];
  nextCursor: string | null;
  metrics: Readonly<Record<string, number>>;
}
export interface DashboardRepository {
  list(
    input: DashboardQuery & {
      organizationId: string;
      documentTypeId: string;
      membershipId: string;
      scope: DashboardScope;
    },
  ): Promise<DashboardResult>;
  exportCsv(
    input: Omit<DashboardQuery, "cursor" | "limit"> & {
      organizationId: string;
      documentTypeId: string;
      membershipId: string;
      scope: DashboardScope;
      limit: number;
    },
  ): Promise<readonly DashboardRow[]>;
  auditExport(
    organizationId: string,
    membershipId: string,
    documentTypeId: string,
    rowCount: number,
  ): Promise<void>;
}
export class DashboardService {
  public constructor(private readonly repository: DashboardRepository) {}
  public list(
    organizationId: string,
    documentTypeId: string,
    membershipId: string,
    scope: DashboardScope,
    query: DashboardQuery,
  ) {
    return this.repository.list({
      ...query,
      organizationId,
      documentTypeId,
      membershipId,
      scope,
    });
  }
  public async export(
    organizationId: string,
    documentTypeId: string,
    membershipId: string,
    scope: DashboardScope,
    query: DashboardQuery,
  ) {
    const rows = await this.repository.exportCsv({
      status: query.status,
      search: query.search,
      sort: query.sort,
      direction: query.direction,
      organizationId,
      documentTypeId,
      membershipId,
      scope,
      limit: 10_000,
    });
    await this.repository.auditExport(
      organizationId,
      membershipId,
      documentTypeId,
      rows.length,
    );
    return toCsv(rows);
  }
}
function toCsv(rows: readonly DashboardRow[]) {
  const escape = (value: string | null) =>
    `"${(value ?? "").replaceAll('"', '""')}"`;
  return [
    "Request number,Title,Status,Department,Current stage,PDF status,Delivery status,Updated at",
    ...rows.map((row) =>
      [
        row.requestNumber,
        row.title,
        row.status,
        row.departmentName,
        row.currentStage,
        row.artifactStatus,
        row.deliveryStatus,
        row.updatedAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\r\n");
}
