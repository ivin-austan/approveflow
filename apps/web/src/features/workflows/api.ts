import type {
  ApproverOption,
  ConfigurationItem,
  ValidationIssue,
  WorkflowDraft,
  WorkflowSummary,
} from "./types";
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
  const response = await fetch(`/api/v1${url}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as Envelope<T>).data;
}
const resource = (o: string, w: string, v: string) =>
  `/organizations/${o}/workflows/${w}/versions/${v}`;
export const workflowApi = {
  get: (o: string, w: string, v: string) =>
    call<WorkflowDraft>(resource(o, w, v), o),
  save: (o: string, w: string, v: string, draft: WorkflowDraft) =>
    call<{ revision: number }>(resource(o, w, v), o, {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: draft.revision,
        allowRequesterSelfApproval: draft.allowRequesterSelfApproval,
        allowNoStageAutomaticApproval: draft.allowNoStageAutomaticApproval,
        formSections: draft.formSections,
        fieldConditions: draft.fieldConditions,
        stages: draft.stages,
      }),
    }),
  validate: (o: string, w: string, v: string) =>
    call<{ valid: boolean; issues: ValidationIssue[] }>(
      `${resource(o, w, v)}/validate`,
      o,
      { method: "POST", body: "{}" },
    ),
  preview: (
    o: string,
    w: string,
    v: string,
    answers: Readonly<Record<string, unknown>>,
  ) =>
    call<{
      stages: {
        id: string;
        name: string;
        position: number;
        result: string;
        assignments: {
          assignmentId: string;
          status: "RESOLVED" | "UNRESOLVED";
          memberships: { id: string; name: string; email: string }[];
        }[];
      }[];
      finalStageId: string | null;
      automaticApproval: boolean;
    }>(`${resource(o, w, v)}/preview`, o, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
  publish: (o: string, w: string, v: string, revision: number) =>
    call<undefined>(`${resource(o, w, v)}/publish`, o, {
      method: "POST",
      body: JSON.stringify({ expectedRevision: revision }),
    }),
  list: (o: string) =>
    call<WorkflowSummary[]>(`/organizations/${o}/workflows`, o),
  create: (
    o: string,
    input: { documentTypeId: string; name: string; description: string | null },
  ) =>
    call<{ id: string; draftVersionId: string }>(
      `/organizations/${o}/workflows`,
      o,
      { method: "POST", body: JSON.stringify(input) },
    ),
  createDraftVersion: (o: string, w: string, sourceVersionId: string) =>
    call<{ id: string; revision: number }>(
      `/organizations/${o}/workflows/${w}/versions`,
      o,
      { method: "POST", body: JSON.stringify({ sourceVersionId }) },
    ),
  memberships: (o: string) =>
    call<ApproverOption[]>(
      `/organizations/${o}/approver-options/memberships`,
      o,
    ),
  roles: (o: string) =>
    call<ApproverOption[]>(`/organizations/${o}/approver-options/roles`, o),
  departments: (o: string) =>
    call<ApproverOption[]>(
      `/organizations/${o}/approver-options/departments`,
      o,
    ),
  calendars: (o: string) =>
    call<ConfigurationItem[]>(`/organizations/${o}/business-calendars`, o),
  documentTypes: (o: string) =>
    call<ConfigurationItem[]>(`/organizations/${o}/document-types`, o),
  createCalendar: (o: string, input: unknown) =>
    call<{ id: string; revision: number }>(
      `/organizations/${o}/business-calendars`,
      o,
      { method: "POST", body: JSON.stringify(input) },
    ),
  createDocumentType: (o: string, input: unknown) =>
    call<{ id: string }>(`/organizations/${o}/document-types`, o, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  invite: (o: string, input: unknown) =>
    call<{ invitationId: string; expiresAt: string }>("/admin/invitations", o, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
