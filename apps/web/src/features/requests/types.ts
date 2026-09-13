export type RequestStatus =
  "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED";
export interface RequestSummary {
  id: string;
  requestNumber: string | null;
  title: string;
  status: RequestStatus;
  revision: number;
  currentStage: string | null;
  submittedAt: string | null;
  updatedAt: string;
}
export interface RequestField {
  id: string;
  type:
    | "SHORT_TEXT"
    | "LONG_TEXT"
    | "NUMBER"
    | "MONEY"
    | "DATE"
    | "BOOLEAN"
    | "SINGLE_SELECT"
    | "MULTI_SELECT"
    | "MEMBER_SELECTOR";
  label: string;
  required: boolean;
  optionValues: string[];
}
export interface RequestForm {
  workflowId: string;
  workflowVersionId: string;
  workflowName: string;
  sections: {
    id: string;
    name: string;
    description: string | null;
    fields: RequestField[];
  }[];
}
export interface RequestTimeline {
  request: Pick<
    RequestSummary,
    "id" | "requestNumber" | "title" | "status" | "revision"
  >;
  stages: {
    id: string;
    levelNumber: number;
    name: string;
    status: string;
    isFinal: boolean;
    activatedAt: string | null;
    dueAt: string | null;
    completedAt: string | null;
    tasks: {
      id: string;
      assigneeName: string;
      status: string;
      activatedAt: string | null;
      decidedAt: string | null;
    }[];
  }[];
  events: {
    id: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: string;
  }[];
}
