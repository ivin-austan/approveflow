import type { RequestForm, RequestSummary, RequestTimeline } from "./types";
import { authenticatedFetch } from "../auth/session";

interface Envelope<T> {
  data: T;
}
async function call<T>(
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
export const requestApi = {
  list: (organizationId: string) =>
    call<RequestSummary[]>(
      `/organizations/${organizationId}/requests`,
      organizationId,
    ),
  timeline: (organizationId: string, requestId: string) =>
    call<RequestTimeline>(
      `/organizations/${organizationId}/requests/${requestId}/timeline`,
      organizationId,
    ),
  form: (organizationId: string, workflowId: string) =>
    call<RequestForm>(
      `/organizations/${organizationId}/request-forms/${workflowId}`,
      organizationId,
    ),
  create: (
    organizationId: string,
    input: {
      workflowId: string;
      title: string;
      answers: Record<string, unknown>;
    },
  ) =>
    call<{ id: string; revision: number }>(
      `/organizations/${organizationId}/requests`,
      organizationId,
      { method: "POST", body: JSON.stringify(input) },
    ),
  resubmit: (
    organizationId: string,
    requestId: string,
    expectedRevision: number,
  ) =>
    call<RequestSummary>(
      `/organizations/${organizationId}/requests/${requestId}/resubmit`,
      organizationId,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ expectedRevision }),
      },
    ),
};
