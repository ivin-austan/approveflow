import { createHash, randomUUID } from "node:crypto";
import type {
  CreateDraftInput,
  SubmitRequestInput,
  ResubmitRequestInput,
  UpdateDraftInput,
} from "./request.schemas.js";
import type {
  AnswerIssue,
  RuntimeField,
  RuntimeFieldCondition,
} from "./answer-validation.js";
import { validateAnswers } from "./answer-validation.js";

export interface RequestSummary {
  readonly id: string;
  readonly requestNumber: string | null;
  readonly title: string;
  readonly status:
    "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED";
  readonly revision: number;
  readonly currentStage: string | null;
  readonly submittedAt: Date | null;
  readonly updatedAt: Date;
}

export interface RequestForm {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly workflowName: string;
  readonly sections: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly fields: readonly RuntimeField[];
  }[];
  readonly conditions: readonly RuntimeFieldCondition[];
}

export interface RequestRepository {
  list(
    organizationId: string,
    membershipId: string,
  ): Promise<readonly RequestSummary[]>;
  getForm(
    organizationId: string,
    workflowId: string,
  ): Promise<RequestForm | null>;
  createDraft(
    input: CreateDraftInput & {
      readonly id: string;
      readonly organizationId: string;
      readonly membershipId: string;
      readonly workflowVersionId: string;
    },
  ): Promise<void>;
  updateDraft(
    input: UpdateDraftInput & {
      readonly organizationId: string;
      readonly membershipId: string;
      readonly requestId: string;
    },
  ): Promise<"UPDATED" | "NOT_FOUND" | "CONFLICT" | "IMMUTABLE">;
  getDraftForSubmission(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ): Promise<{
    readonly revision: number;
    readonly status: "DRAFT" | "RETURNED";
    readonly originatingDepartmentId: string | null;
    readonly form: RequestForm;
    readonly answers: Readonly<Record<string, unknown>>;
  } | null>;
  submit(
    input: SubmitRequestInput & {
      readonly organizationId: string;
      readonly membershipId: string;
      readonly requestId: string;
      readonly idempotencyKey: string;
      readonly requestHash: string;
    },
  ): Promise<
    | {
        readonly outcome: "SUBMITTED" | "REPLAY";
        readonly request: RequestSummary;
      }
    | {
        readonly outcome:
          | "NOT_FOUND"
          | "CONFLICT"
          | "IDEMPOTENCY_MISMATCH"
          | "INVALID_DEPARTMENT"
          | "NO_APPLICABLE_STAGE"
          | "NO_ELIGIBLE_APPROVER";
      }
  >;
  get(
    organizationId: string,
    membershipId: string,
    requestId: string,
  ): Promise<RequestSummary | null>;
}

export class RequestInputError extends Error {
  public constructor(public readonly issues: readonly AnswerIssue[]) {
    super("Request answers are invalid.");
  }
}
export class RequestNotFoundError extends Error {}
export class RequestConflictError extends Error {}
export class RequestImmutableError extends Error {}
export class SubmissionError extends Error {
  public constructor(
    public readonly code:
      | "IDEMPOTENCY_MISMATCH"
      | "INVALID_DEPARTMENT"
      | "NO_APPLICABLE_STAGE"
      | "NO_ELIGIBLE_APPROVER",
  ) {
    super(code);
  }
}

export class RequestService {
  public constructor(private readonly repository: RequestRepository) {}
  public list(organizationId: string, membershipId: string) {
    return this.repository.list(organizationId, membershipId);
  }
  public getForm(organizationId: string, workflowId: string) {
    return this.repository.getForm(organizationId, workflowId);
  }
  public get(organizationId: string, membershipId: string, requestId: string) {
    return this.repository.get(organizationId, membershipId, requestId);
  }
  public async createDraft(
    organizationId: string,
    membershipId: string,
    input: CreateDraftInput,
  ) {
    const form = await this.repository.getForm(
      organizationId,
      input.workflowId,
    );
    if (!form) throw new RequestNotFoundError("Published workflow not found");
    const issues = validateAnswers(
      form.sections.flatMap((section) => section.fields),
      form.conditions,
      input.answers,
    );
    if (issues.length) throw new RequestInputError(issues);
    const id = randomUUID();
    await this.repository.createDraft({
      ...input,
      id,
      organizationId,
      membershipId,
      workflowVersionId: form.workflowVersionId,
    });
    return { id, revision: 1 };
  }
  public async updateDraft(
    organizationId: string,
    membershipId: string,
    requestId: string,
    input: UpdateDraftInput,
  ) {
    const draft = await this.repository.getDraftForSubmission(
      organizationId,
      membershipId,
      requestId,
    );
    if (!draft) throw new RequestNotFoundError("Request not found");
    const issues = validateAnswers(
      draft.form.sections.flatMap((section) => section.fields),
      draft.form.conditions,
      input.answers,
    );
    if (issues.length) throw new RequestInputError(issues);
    const result = await this.repository.updateDraft({
      ...input,
      organizationId,
      membershipId,
      requestId,
    });
    if (result === "NOT_FOUND")
      throw new RequestNotFoundError("Request not found");
    if (result === "CONFLICT")
      throw new RequestConflictError("Request changed; reload and try again");
    if (result === "IMMUTABLE")
      throw new RequestImmutableError("Submitted requests cannot be edited");
    return { revision: input.expectedRevision + 1 };
  }
  public async submit(
    organizationId: string,
    membershipId: string,
    requestId: string,
    idempotencyKey: string,
    input: SubmitRequestInput,
  ) {
    const draft = await this.repository.getDraftForSubmission(
      organizationId,
      membershipId,
      requestId,
    );
    if (!draft) throw new RequestNotFoundError("Request not found");
    const issues = validateAnswers(
      draft.form.sections.flatMap((section) => section.fields),
      draft.form.conditions,
      draft.answers,
    );
    if (issues.length) throw new RequestInputError(issues);
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ requestId, ...input }))
      .digest("hex");
    const result = await this.repository.submit({
      ...input,
      organizationId,
      membershipId,
      requestId,
      idempotencyKey,
      requestHash,
    });
    switch (result.outcome) {
      case "NOT_FOUND":
        throw new RequestNotFoundError("Request not found");
      case "CONFLICT":
        throw new RequestConflictError("Request changed; reload and try again");
      case "IDEMPOTENCY_MISMATCH":
      case "INVALID_DEPARTMENT":
      case "NO_APPLICABLE_STAGE":
      case "NO_ELIGIBLE_APPROVER":
        throw new SubmissionError(result.outcome);
      case "SUBMITTED":
      case "REPLAY":
        return result.request;
    }
  }

  public async resubmit(
    organizationId: string,
    membershipId: string,
    requestId: string,
    idempotencyKey: string,
    input: ResubmitRequestInput,
  ) {
    const request = await this.repository.getDraftForSubmission(
      organizationId,
      membershipId,
      requestId,
    );
    if (request?.status !== "RETURNED" || !request.originatingDepartmentId)
      throw new RequestNotFoundError("Returned request not found");
    return this.submit(
      organizationId,
      membershipId,
      requestId,
      idempotencyKey,
      {
        expectedRevision: input.expectedRevision,
        originatingDepartmentId: request.originatingDepartmentId,
      },
    );
  }
}
