import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  auditEvents,
  departments,
  requests,
  schema as databaseSchema,
} from "@approveflow/database";
import type {
  DashboardRepository,
  DashboardRow,
  DashboardScope,
} from "./dashboard.service.js";

type Database = NodePgDatabase<typeof databaseSchema>;
interface Cursor {
  value: string;
  id: string;
}
export class DrizzleDashboardRepository implements DashboardRepository {
  public constructor(private readonly database: Database) {}
  public async list(input: Parameters<DashboardRepository["list"]>[0]) {
    const rows = await this.rows(input, input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > input.limit && last
        ? encodeCursor({ value: sortValue(last, input.sort), id: last.id })
        : null;
    const statusRows = await this.database
      .select({ status: requests.status, count: sql<number>`count(*)::int` })
      .from(requests)
      .where(
        and(
          eq(requests.organizationId, input.organizationId),
          eq(requests.documentTypeId, input.documentTypeId),
          scopeCondition(input.scope, input.membershipId),
        ),
      )
      .groupBy(requests.status);
    return {
      rows: page,
      nextCursor,
      metrics: Object.fromEntries(
        statusRows.map((row) => [row.status, row.count]),
      ),
    };
  }
  public exportCsv(input: Parameters<DashboardRepository["exportCsv"]>[0]) {
    return this.rows(input, input.limit);
  }
  public async auditExport(
    organizationId: string,
    membershipId: string,
    documentTypeId: string,
    rowCount: number,
  ) {
    await this.database.insert(auditEvents).values({
      organizationId,
      actorMembershipId: membershipId,
      eventType: "DASHBOARD_CSV_EXPORTED",
      payload: { documentTypeId, rowCount },
    });
  }
  private async rows(
    input:
      | Parameters<DashboardRepository["list"]>[0]
      | Parameters<DashboardRepository["exportCsv"]>[0],
    limit: number,
  ): Promise<DashboardRow[]> {
    const cursor = "cursor" in input ? decodeCursor(input.cursor) : null;
    const column = sortColumn(input.sort);
    const conditions: SQL[] = [
      eq(requests.organizationId, input.organizationId),
      eq(requests.documentTypeId, input.documentTypeId),
      scopeCondition(input.scope, input.membershipId),
    ];
    if (input.status) conditions.push(eq(requests.status, input.status));
    if (input.search)
      conditions.push(
        or(
          ilike(requests.title, `%${input.search}%`),
          ilike(requests.requestNumber, `%${input.search}%`),
        ) ?? sql`false`,
      );
    if (cursor)
      conditions.push(
        cursorCondition(column, input.sort, input.direction, cursor),
      );
    const order = input.direction === "asc" ? asc : desc;
    return this.database
      .select({
        id: requests.id,
        requestNumber: requests.requestNumber,
        title: requests.title,
        status: requests.status,
        requesterMembershipId: requests.requesterMembershipId,
        departmentName: departments.name,
        currentStage: sql<
          string | null
        >`(select name from runtime_stages where organization_id = ${input.organizationId} and request_id = ${requests.id} and status = 'ACTIVE' limit 1)`,
        artifactId: sql<
          string | null
        >`(select id from approved_artifacts where organization_id = ${input.organizationId} and request_id = ${requests.id} order by created_at desc limit 1)`,
        artifactStatus: sql<
          string | null
        >`(select status::text from approved_artifacts where organization_id = ${input.organizationId} and request_id = ${requests.id} order by created_at desc limit 1)`,
        legalHold: sql<
          boolean | null
        >`(select legal_hold from approved_artifacts where organization_id = ${input.organizationId} and request_id = ${requests.id} order by created_at desc limit 1)`,
        deliveryId: sql<
          string | null
        >`(select d.id from artifact_deliveries d join approved_artifacts a on a.id = d.artifact_id and a.organization_id = d.organization_id where a.organization_id = ${input.organizationId} and a.request_id = ${requests.id} order by d.created_at desc limit 1)`,
        deliveryStatus: sql<
          string | null
        >`(select d.status::text from artifact_deliveries d join approved_artifacts a on a.id = d.artifact_id and a.organization_id = d.organization_id where a.organization_id = ${input.organizationId} and a.request_id = ${requests.id} order by d.created_at desc limit 1)`,
        updatedAt: requests.updatedAt,
      })
      .from(requests)
      .leftJoin(
        departments,
        and(
          eq(departments.organizationId, requests.organizationId),
          eq(departments.id, requests.originatingDepartmentId),
        ),
      )
      .where(and(...conditions))
      .orderBy(order(column), order(requests.id))
      .limit(limit);
  }
}
function scopeCondition(scope: DashboardScope, membershipId: string): SQL {
  if (scope === "ALL") return sql`true`;
  if (scope === "OWN") return eq(requests.requesterMembershipId, membershipId);
  if (scope === "ASSIGNED")
    return sql`exists (select 1 from approval_tasks t where t.organization_id = ${requests.organizationId} and t.request_id = ${requests.id} and t.assigned_membership_id = ${membershipId})`;
  return sql`exists (select 1 from membership_departments md where md.organization_id = ${requests.organizationId} and md.membership_id = ${membershipId} and md.department_id = ${requests.originatingDepartmentId})`;
}
function sortColumn(
  sort: "updatedAt" | "requestNumber" | "title",
): AnyPgColumn {
  return sort === "requestNumber"
    ? requests.requestNumber
    : sort === "title"
      ? requests.title
      : requests.updatedAt;
}
function sortValue(
  row: DashboardRow,
  sort: "updatedAt" | "requestNumber" | "title",
) {
  return sort === "requestNumber"
    ? (row.requestNumber ?? "")
    : sort === "title"
      ? row.title
      : row.updatedAt.toISOString();
}
function cursorCondition(
  column: AnyPgColumn,
  sort: "updatedAt" | "requestNumber" | "title",
  direction: "asc" | "desc",
  cursor: Cursor,
): SQL {
  const value = sort === "updatedAt" ? new Date(cursor.value) : cursor.value;
  const compare = direction === "asc" ? gt : lt;
  return (
    or(
      compare(column, value),
      and(eq(column, value), compare(requests.id, cursor.id)),
    ) ?? sql`false`
  );
}
function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "value" in parsed &&
      "id" in parsed &&
      typeof parsed.value === "string" &&
      typeof parsed.id === "string"
    )
      return { value: parsed.value, id: parsed.id };
  } catch {
    return null;
  }
  return null;
}
