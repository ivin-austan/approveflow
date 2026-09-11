export interface Duration {
  value: number;
  unit: "BUSINESS_HOURS" | "BUSINESS_DAYS";
}
export type Condition =
  | {
      kind: "comparison";
      fieldId: string;
      operator: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "contains";
      value: string | number | boolean | (string | number | boolean)[];
    }
  | { kind: "isEmpty"; fieldId: string; empty: boolean }
  | { kind: "group"; operator: "all" | "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };
export type Assignment =
  | { id: string; assignmentType: "REQUESTER_MANAGER"; displayOrder: number }
  | {
      id: string;
      assignmentType: "MEMBERSHIP";
      membershipId?: string;
      invitationId?: string;
      displayOrder: number;
    }
  | { id: string; assignmentType: "ROLE"; roleId: string; displayOrder: number }
  | {
      id: string;
      assignmentType: "DEPARTMENT_ROLE";
      departmentId: string;
      roleId: string;
      displayOrder: number;
    }
  | {
      id: string;
      assignmentType: "FORM_FIELD_USER";
      formFieldId: string;
      displayOrder: number;
    };
export interface TimedRule {
  id: string;
  sequence: number;
  offset: Duration;
  offsetAnchor: "ACTIVATION" | "DUE_TIME";
}
export type ReminderRule = TimedRule & {
  recipientPolicy: { type: "STAGE_APPROVERS" };
};
export type EscalationRule = TimedRule &
  (
    | { action: "RETURN_TO_INITIATOR" }
    | { action: "NOTIFY"; recipientPolicy: { type: "STAGE_APPROVERS" } }
  );
export interface Stage {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  position: number;
  completionPolicy: "ANY" | "ALL";
  dueDuration: Duration | null;
  businessCalendarId: string | null;
  activationCondition: Condition | null;
  approvers: Assignment[];
  reminders: ReminderRule[];
  escalations: EscalationRule[];
}
export type FieldType =
  | "SHORT_TEXT"
  | "LONG_TEXT"
  | "NUMBER"
  | "MONEY"
  | "DATE"
  | "BOOLEAN"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "MEMBER_SELECTOR";
export interface FormField {
  id: string;
  stableKey: string;
  type: FieldType;
  label: string;
  description: string | null;
  required: boolean;
  position: number;
  config: Record<string, unknown>;
  options: {
    id: string;
    stableValue: string;
    label: string;
    position: number;
  }[];
}
export interface FormSection {
  id: string;
  stableKey: string;
  name: string;
  description: string | null;
  position: number;
  fields: FormField[];
}
export interface FieldCondition {
  id: string;
  targetFormFieldId: string;
  effect: "SHOW" | "HIDE" | "REQUIRE";
  condition: Condition;
}
export interface WorkflowDraft {
  workflowId: string;
  versionId: string;
  revision: number;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  allowRequesterSelfApproval: boolean;
  allowNoStageAutomaticApproval: boolean;
  formSections: FormSection[];
  fieldConditions: FieldCondition[];
  stages: Stage[];
}
export interface ValidationIssue {
  code: string;
  entityType: "WORKFLOW" | "FORM_FIELD" | "STAGE" | "STAGE_APPROVER";
  entityId: string;
  path: string;
  message: string;
}
export interface ApproverOption {
  id: string;
  name?: string;
  fullName?: string;
  email?: string;
  status?: string;
  roles?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
}
export interface WorkflowSummary {
  id: string;
  documentTypeId: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  currentPublishedVersionId: string | null;
  currentDraftVersionId: string | null;
}
export interface ConfigurationItem {
  id: string;
  name: string;
  code?: string;
  timezone?: string;
  isDefault?: boolean;
  revision?: number;
}
