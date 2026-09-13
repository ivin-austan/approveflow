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
  updatedAt: string;
}
export interface DashboardResult {
  rows: DashboardRow[];
  nextCursor: string | null;
  metrics: Record<string, number>;
}
interface Envelope<T> {
  data: T;
}
async function json<T>(
  url: string,
  organizationId: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  headers.set("x-organization-id", organizationId);
  const response = await authenticatedFetch(`/api/v1${url}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as Envelope<T>).data;
}
export interface DashboardFilters {
  status?: string;
  search?: string;
  sort?: "updatedAt" | "requestNumber" | "title";
  direction?: "asc" | "desc";
  cursor?: string;
}
function query(filters: DashboardFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.cursor) params.set("cursor", filters.cursor);
  return params.toString();
}
export const dashboardApi = {
  list: (
    organizationId: string,
    documentTypeId: string,
    filters: DashboardFilters,
  ) =>
    json<DashboardResult>(
      `/organizations/${organizationId}/document-types/${documentTypeId}/dashboard?${query(filters)}`,
      organizationId,
    ),
  async exportCsv(
    organizationId: string,
    documentTypeId: string,
    filters: DashboardFilters,
  ) {
    const response = await authenticatedFetch(
      `/api/v1/organizations/${organizationId}/document-types/${documentTypeId}/dashboard/export?${query(filters)}`,
      {
        credentials: "include",
        headers: { "x-organization-id": organizationId },
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.blob();
  },
  async artifact(
    organizationId: string,
    artifactId: string,
    purpose: "VIEW" | "PRINT" | "DOWNLOAD",
  ) {
    const grant = await json<{ token: string }>(
      `/organizations/${organizationId}/artifacts/${artifactId}/access-grants`,
      organizationId,
      { method: "POST", body: JSON.stringify({ purpose }) },
    );
    const response = await authenticatedFetch(
      `/api/v1/organizations/${organizationId}/artifacts/${artifactId}/content?purpose=${purpose}`,
      {
        credentials: "include",
        headers: {
          "x-organization-id": organizationId,
          "x-artifact-grant": grant.token,
        },
      },
    );
    if (!response.ok) throw new Error(await response.text());
    return response.blob();
  },
  retryArtifact(organizationId: string, artifactId: string) {
    return json<{ artifactId: string }>(
      `/organizations/${organizationId}/artifacts/${artifactId}/retry`,
      organizationId,
      { method: "POST", body: "{}" },
    );
  },
  reopenDelivery(organizationId: string, deliveryId: string) {
    return json<{ deliveryId: string }>(
      `/organizations/${organizationId}/deliveries/${deliveryId}/reopen`,
      organizationId,
      { method: "POST", body: "{}" },
    );
  },
  setLegalHold(organizationId: string, artifactId: string, enabled: boolean) {
    return json<{ artifactId: string; legalHold: boolean }>(
      `/organizations/${organizationId}/artifacts/${artifactId}/legal-hold`,
      organizationId,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    );
  },
};
import { authenticatedFetch } from "../auth/session";
