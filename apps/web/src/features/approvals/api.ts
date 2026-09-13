export interface InboxTask {
  id: string;
  requestId: string;
  requestNumber: string;
  requestTitle: string;
  requestRevision: number;
  stageName: string;
  activatedAt: string;
}
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
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as Envelope<T>).data;
}
export const approvalApi = {
  inbox: (organizationId: string) =>
    call<InboxTask[]>(
      `/organizations/${organizationId}/approvals/inbox`,
      organizationId,
    ),
  decide: (
    organizationId: string,
    taskId: string,
    input: {
      action: "APPROVE" | "REJECT" | "RETURN";
      comment: string | null;
      expectedRequestRevision: number;
    },
  ) =>
    call<undefined>(
      `/organizations/${organizationId}/approvals/${taskId}/decisions`,
      organizationId,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(input),
      },
    ),
};
import { authenticatedFetch } from "../auth/session";
