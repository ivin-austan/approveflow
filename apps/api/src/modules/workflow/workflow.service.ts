import { randomUUID } from "node:crypto";
import { evaluateCondition, referencedFieldIds } from "./condition.js";
import type { CreateWorkflow, ReplaceDraft } from "./workflow.schemas.js";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: "ERROR";
  readonly entityType: "WORKFLOW" | "FORM_FIELD" | "STAGE" | "STAGE_APPROVER";
  readonly entityId: string;
  readonly path: string;
  readonly message: string;
}

export type StoredDraft = ReplaceDraft & {
  readonly workflowId: string;
  readonly versionId: string;
  readonly status: "DRAFT" | "PUBLISHED" | "RETIRED";
  readonly revision: number;
  readonly automaticApprovalEnabled: boolean;
};
export interface AssignmentPreview {
  readonly assignmentId: string;
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly memberships: readonly {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  }[];
}

export interface WorkflowRepository {
  list(organizationId: string): Promise<
    readonly {
      readonly id: string;
      readonly documentTypeId: string;
      readonly name: string;
      readonly description: string | null;
      readonly status: "ACTIVE" | "ARCHIVED";
      readonly currentPublishedVersionId: string | null;
      readonly currentDraftVersionId: string | null;
    }[]
  >;
  create(
    input: CreateWorkflow & {
      readonly id: string;
      readonly versionId: string;
      readonly organizationId: string;
      readonly membershipId: string;
    },
  ): Promise<boolean>;
  createDraftVersion(input: {
    readonly organizationId: string;
    readonly workflowId: string;
    readonly sourceVersionId: string;
    readonly versionId: string;
    readonly definition: ReplaceDraft;
  }): Promise<"CREATED" | "NOT_FOUND" | "DRAFT_EXISTS">;
  getDraft(
    organizationId: string,
    workflowId: string,
    versionId: string,
  ): Promise<StoredDraft | null>;
  replaceDraft(input: {
    readonly organizationId: string;
    readonly workflowId: string;
    readonly versionId: string;
    readonly expectedRevision: number;
    readonly definition: ReplaceDraft;
  }): Promise<"UPDATED" | "NOT_FOUND" | "CONFLICT" | "IMMUTABLE">;
  validateReferences(
    organizationId: string,
    draft: StoredDraft,
  ): Promise<readonly ValidationIssue[]>;
  previewAssignments(
    organizationId: string,
    draft: StoredDraft,
    answers: Readonly<Record<string, unknown>>,
  ): Promise<readonly AssignmentPreview[]>;
  publish(input: {
    readonly organizationId: string;
    readonly workflowId: string;
    readonly versionId: string;
    readonly membershipId: string;
    readonly expectedRevision: number;
  }): Promise<"PUBLISHED" | "NOT_FOUND" | "CONFLICT" | "INVALID">;
}

export class WorkflowNotFoundError extends Error {}
export class WorkflowRevisionConflictError extends Error {}
export class PublishedWorkflowImmutableError extends Error {}
export class WorkflowDraftExistsError extends Error {}
export class InvalidWorkflowError extends Error {
  public constructor(public readonly issues: readonly ValidationIssue[]) {
    super("The workflow must be corrected before publication.");
  }
}

export class WorkflowService {
  public constructor(private readonly repository: WorkflowRepository) {}

  public list(organizationId: string) {
    return this.repository.list(organizationId);
  }

  public async create(
    organizationId: string,
    membershipId: string,
    input: CreateWorkflow,
  ) {
    const id = randomUUID();
    const versionId = randomUUID();
    const created = await this.repository.create({
      ...input,
      id,
      versionId,
      organizationId,
      membershipId,
    });
    if (!created) throw new WorkflowNotFoundError("Document type not found");
    return { id, draftVersionId: versionId };
  }

  public async createDraftVersion(
    organizationId: string,
    workflowId: string,
    sourceVersionId: string,
  ) {
    const source = await this.requireDraft(
      organizationId,
      workflowId,
      sourceVersionId,
    );
    if (source.status !== "PUBLISHED") throw new WorkflowNotFoundError();
    const versionId = randomUUID();
    const definition = cloneDefinition(source);
    const result = await this.repository.createDraftVersion({
      organizationId,
      workflowId,
      sourceVersionId,
      versionId,
      definition,
    });
    if (result === "NOT_FOUND") throw new WorkflowNotFoundError();
    if (result === "DRAFT_EXISTS") throw new WorkflowDraftExistsError();
    return { id: versionId, revision: 1 };
  }

  public async replaceDraft(
    organizationId: string,
    workflowId: string,
    versionId: string,
    definition: ReplaceDraft,
  ): Promise<{ readonly revision: number }> {
    const result = await this.repository.replaceDraft({
      organizationId,
      workflowId,
      versionId,
      expectedRevision: definition.expectedRevision,
      definition,
    });
    if (result === "NOT_FOUND") throw new WorkflowNotFoundError();
    if (result === "CONFLICT") throw new WorkflowRevisionConflictError();
    if (result === "IMMUTABLE") throw new PublishedWorkflowImmutableError();
    return { revision: definition.expectedRevision + 1 };
  }

  public getDraft(
    organizationId: string,
    workflowId: string,
    versionId: string,
  ): Promise<StoredDraft | null> {
    return this.repository.getDraft(organizationId, workflowId, versionId);
  }

  public async validate(
    organizationId: string,
    workflowId: string,
    versionId: string,
  ) {
    const draft = await this.requireDraft(
      organizationId,
      workflowId,
      versionId,
    );
    const issues = [
      ...this.structuralIssues(draft),
      ...(await this.repository.validateReferences(organizationId, draft)),
    ];
    return { valid: issues.length === 0, issues };
  }

  public async preview(
    organizationId: string,
    workflowId: string,
    versionId: string,
    answers: Readonly<Record<string, unknown>>,
  ) {
    const draft = await this.requireDraft(
      organizationId,
      workflowId,
      versionId,
    );
    const stages = draft.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      result: stage.activationCondition
        ? evaluateCondition(stage.activationCondition, answers)
        : ("MATCHED" as const),
    }));
    const assignments = await this.repository.previewAssignments(
      organizationId,
      draft,
      answers,
    );
    const included = stages.filter((stage) => stage.result === "MATCHED");
    return {
      stages: stages.map((stage) => ({
        ...stage,
        assignments: assignments.filter((item) =>
          draft.stages
            .find((candidate) => candidate.id === stage.id)
            ?.approvers.some((approver) => approver.id === item.assignmentId),
        ),
      })),
      finalStageId: included.at(-1)?.id ?? null,
      automaticApproval:
        included.length === 0 &&
        draft.allowNoStageAutomaticApproval &&
        draft.automaticApprovalEnabled,
    };
  }

  public async publish(
    organizationId: string,
    workflowId: string,
    versionId: string,
    membershipId: string,
    expectedRevision: number,
  ): Promise<void> {
    const validation = await this.validate(
      organizationId,
      workflowId,
      versionId,
    );
    if (!validation.valid) throw new InvalidWorkflowError(validation.issues);
    const result = await this.repository.publish({
      organizationId,
      workflowId,
      versionId,
      membershipId,
      expectedRevision,
    });
    if (result === "NOT_FOUND") throw new WorkflowNotFoundError();
    if (result === "CONFLICT") throw new WorkflowRevisionConflictError();
    if (result === "INVALID") throw new InvalidWorkflowError([]);
  }

  private async requireDraft(
    organizationId: string,
    workflowId: string,
    versionId: string,
  ): Promise<StoredDraft> {
    const draft = await this.repository.getDraft(
      organizationId,
      workflowId,
      versionId,
    );
    if (!draft) throw new WorkflowNotFoundError();
    return draft;
  }

  private structuralIssues(draft: StoredDraft): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!(
      draft.stages.length > 0 ||
      (draft.allowNoStageAutomaticApproval && draft.automaticApprovalEnabled)
    ))
      issues.push({
        code: "STAGE_REQUIRED",
        severity: "ERROR",
        entityType: "WORKFLOW",
        entityId: draft.workflowId,
        path: "stages",
        message:
          "At least one approval stage is required unless automatic approval is enabled.",
      });
    const fieldIds = new Set(
      draft.formSections.flatMap((section) =>
        section.fields.map((field) => field.id),
      ),
    );
    for (const item of draft.fieldConditions) {
      if (
        !fieldIds.has(item.targetFormFieldId) ||
        [...referencedFieldIds(item.condition)].some((id) => !fieldIds.has(id))
      )
        issues.push({
          code: "INVALID_FIELD_CONDITION_REFERENCE",
          severity: "ERROR",
          entityType: "FORM_FIELD",
          entityId: item.targetFormFieldId,
          path: "fieldConditions",
          message:
            "Field condition references must belong to this workflow version.",
        });
    }
    for (const stage of draft.stages)
      if (
        stage.activationCondition &&
        [...referencedFieldIds(stage.activationCondition)].some(
          (id) => !fieldIds.has(id),
        )
      )
        issues.push({
          code: "INVALID_STAGE_CONDITION_REFERENCE",
          severity: "ERROR",
          entityType: "STAGE",
          entityId: stage.id,
          path: `stages.${String(stage.position - 1)}.activationCondition`,
          message:
            "Stage condition references must belong to this workflow version.",
        });
    return issues;
  }
}

function cloneDefinition(source: StoredDraft): ReplaceDraft {
  const fieldIds = new Map<string, string>();
  const formSections = source.formSections.map((section) => ({
    ...section,
    id: randomUUID(),
    fields: section.fields.map((field) => {
      const id = randomUUID();
      fieldIds.set(field.id, id);
      return {
        ...field,
        id,
        options: field.options.map((option) => ({
          ...option,
          id: randomUUID(),
        })),
      };
    }),
  }));
  const remapCondition = (
    condition: NonNullable<
      ReplaceDraft["stages"][number]["activationCondition"]
    >,
  ): NonNullable<ReplaceDraft["stages"][number]["activationCondition"]> => {
    if (condition.kind === "group")
      return {
        ...condition,
        conditions: condition.conditions.map(remapCondition),
      };
    if (condition.kind === "not")
      return { ...condition, condition: remapCondition(condition.condition) };
    return {
      ...condition,
      fieldId: fieldIds.get(condition.fieldId) ?? condition.fieldId,
    };
  };
  return {
    expectedRevision: 1,
    allowRequesterSelfApproval: source.allowRequesterSelfApproval,
    allowNoStageAutomaticApproval: source.allowNoStageAutomaticApproval,
    formSections,
    fieldConditions: source.fieldConditions.map((item) => ({
      ...item,
      id: randomUUID(),
      targetFormFieldId:
        fieldIds.get(item.targetFormFieldId) ?? item.targetFormFieldId,
      condition: remapCondition(item.condition),
    })),
    stages: source.stages.map((stage) => ({
      ...stage,
      id: randomUUID(),
      activationCondition: stage.activationCondition
        ? remapCondition(stage.activationCondition)
        : null,
      approvers: stage.approvers.map((approver) => ({
        ...approver,
        id: randomUUID(),
        ...(approver.assignmentType === "FORM_FIELD_USER"
          ? {
              formFieldId:
                fieldIds.get(approver.formFieldId) ?? approver.formFieldId,
            }
          : {}),
      })),
      reminders: stage.reminders.map((rule) => ({ ...rule, id: randomUUID() })),
      escalations: stage.escalations.map((rule) => ({
        ...rule,
        id: randomUUID(),
      })),
    })),
  };
}
