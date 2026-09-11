import { evaluateCondition } from "./condition.js";
import type { ReplaceDraft } from "./workflow.schemas.js";

export interface ValidationIssue {
  readonly code: string;
  readonly severity: "ERROR";
  readonly entityType: "WORKFLOW" | "STAGE" | "STAGE_APPROVER";
  readonly entityId: string;
  readonly path: string;
  readonly message: string;
}

export type StoredDraft = ReplaceDraft & {
  readonly workflowId: string;
  readonly versionId: string;
  readonly revision: number;
  readonly automaticApprovalEnabled: boolean;
};

export interface WorkflowRepository {
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
export class InvalidWorkflowError extends Error {
  public constructor(public readonly issues: readonly ValidationIssue[]) {
    super("The workflow must be corrected before publication.");
  }
}

export class WorkflowService {
  public constructor(private readonly repository: WorkflowRepository) {}

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
    const included = stages.filter((stage) => stage.result === "MATCHED");
    return {
      stages,
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
    if (
      draft.stages.length > 0 ||
      (draft.allowNoStageAutomaticApproval && draft.automaticApprovalEnabled)
    )
      return [];
    return [
      {
        code: "STAGE_REQUIRED",
        severity: "ERROR",
        entityType: "WORKFLOW",
        entityId: draft.workflowId,
        path: "stages",
        message:
          "At least one approval stage is required unless automatic approval is enabled.",
      },
    ];
  }
}
