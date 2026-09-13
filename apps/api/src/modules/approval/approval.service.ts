import { createHash } from "node:crypto";
import type { DecisionInput, ReassignInput } from "./approval.schemas.js";

export interface ApprovalRepository {
  inbox(
    organizationId: string,
    membershipId: string,
  ): Promise<
    readonly {
      id: string;
      requestId: string;
      requestNumber: string;
      requestTitle: string;
      requestRevision: number;
      stageName: string;
      activatedAt: Date;
    }[]
  >;
  decide(
    input: DecisionInput & {
      organizationId: string;
      membershipId: string;
      taskId: string;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<
    | "DECIDED"
    | "REPLAY"
    | "NOT_FOUND"
    | "STALE"
    | "SELF_APPROVAL_DENIED"
    | "IDEMPOTENCY_MISMATCH"
  >;
  reassign(
    input: ReassignInput & {
      organizationId: string;
      membershipId: string;
      taskId: string;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<
    | "REASSIGNED"
    | "REPLAY"
    | "NOT_FOUND"
    | "STALE"
    | "INVALID_REPLACEMENT"
    | "IDEMPOTENCY_MISMATCH"
  >;
}

export class ApprovalCommandError extends Error {
  public constructor(
    public readonly code:
      | "NOT_FOUND"
      | "STALE"
      | "SELF_APPROVAL_DENIED"
      | "INVALID_REPLACEMENT"
      | "IDEMPOTENCY_MISMATCH",
  ) {
    super(code);
  }
}

export class ApprovalService {
  public constructor(private readonly repository: ApprovalRepository) {}
  public inbox(organizationId: string, membershipId: string) {
    return this.repository.inbox(organizationId, membershipId);
  }
  public async decide(
    organizationId: string,
    membershipId: string,
    taskId: string,
    idempotencyKey: string,
    input: DecisionInput,
  ) {
    const requestHash = hash({ taskId, ...input });
    const result = await this.repository.decide({
      ...input,
      organizationId,
      membershipId,
      taskId,
      idempotencyKey,
      requestHash,
    });
    if (result !== "DECIDED" && result !== "REPLAY")
      throw new ApprovalCommandError(result);
  }
  public async reassign(
    organizationId: string,
    membershipId: string,
    taskId: string,
    idempotencyKey: string,
    input: ReassignInput,
  ) {
    const requestHash = hash({ taskId, ...input });
    const result = await this.repository.reassign({
      ...input,
      organizationId,
      membershipId,
      taskId,
      idempotencyKey,
      requestHash,
    });
    if (result !== "REASSIGNED" && result !== "REPLAY")
      throw new ApprovalCommandError(result);
  }
}
function hash(value: Readonly<Record<string, unknown>>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
