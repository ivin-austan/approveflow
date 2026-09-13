import { createHash, randomBytes } from "node:crypto";

export interface ApprovedPdfModel {
  readonly requestNumber: string;
  readonly title: string;
  readonly workflowName: string;
  readonly approvedAt: string;
  readonly fields: readonly { label: string; value: string }[];
  readonly decisions: readonly {
    stage: string;
    approver: string;
    decision: string;
    timestamp: string;
    comment: string | null;
  }[];
}
export interface ArtifactClaim {
  id: string;
  organizationId: string;
  requestId: string;
  objectKey: string;
  attempts: number;
  model: ApprovedPdfModel;
}
export interface ArtifactDeletionClaim {
  id: string;
  objectKey: string;
  attempts: number;
}
export interface ArtifactRepository {
  claimGeneration(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<ArtifactClaim | null>;
  markReady(input: {
    artifactId: string;
    workerId: string;
    sha256: string;
    sizeBytes: bigint;
    now: Date;
  }): Promise<boolean>;
  markGenerationFailure(input: {
    artifactId: string;
    workerId: string;
    errorCode: string;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean>;
  createGrant(input: {
    organizationId: string;
    artifactId: string;
    audienceMembershipId: string;
    purpose: "VIEW" | "PRINT" | "DOWNLOAD";
    tokenHash: string;
    expiresAt: Date;
  }): Promise<boolean>;
  consumeGrant(input: {
    organizationId: string;
    artifactId: string;
    audienceMembershipId: string;
    purpose: "VIEW" | "PRINT" | "DOWNLOAD";
    tokenHash: string;
    now: Date;
  }): Promise<{ objectKey: string; sha256: string; requestId: string } | null>;
  retryGeneration(input: {
    organizationId: string;
    artifactId: string;
    actorMembershipId: string;
    now: Date;
  }): Promise<boolean>;
  claimDeletion(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<ArtifactDeletionClaim | null>;
  markDeleted(
    artifactId: string,
    workerId: string,
    now: Date,
  ): Promise<boolean>;
  markDeletionFailure(
    artifactId: string,
    workerId: string,
    errorCode: string,
    retryAt: Date | null,
    now: Date,
  ): Promise<boolean>;
  setLegalHold(input: {
    organizationId: string;
    artifactId: string;
    actorMembershipId: string;
    enabled: boolean;
    now: Date;
  }): Promise<boolean>;
}
export interface ArtifactStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export interface PdfRenderer {
  render(model: ApprovedPdfModel): Uint8Array;
}

export class ArtifactGenerationService {
  public constructor(
    private readonly repository: ArtifactRepository,
    private readonly storage: ArtifactStorage,
    private readonly renderer: PdfRenderer,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async processNext(
    workerId: string,
  ): Promise<"IDLE" | "READY" | "RETRY" | "FAILED"> {
    const startedAt = this.now();
    const claim = await this.repository.claimGeneration(
      workerId,
      startedAt,
      new Date(startedAt.getTime() + 5 * 60_000),
    );
    if (!claim) return "IDLE";
    try {
      const bytes = this.renderer.render(claim.model);
      await this.storage.put(claim.objectKey, bytes);
      const ready = await this.repository.markReady({
        artifactId: claim.id,
        workerId,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: BigInt(bytes.byteLength),
        now: this.now(),
      });
      return ready ? "READY" : "FAILED";
    } catch (error) {
      const exhausted = claim.attempts >= 5;
      const nextAttemptAt = exhausted
        ? null
        : new Date(this.now().getTime() + retryDelay(claim.attempts));
      await this.repository.markGenerationFailure({
        artifactId: claim.id,
        workerId,
        errorCode: safeErrorCode(error),
        nextAttemptAt,
        now: this.now(),
      });
      return exhausted ? "FAILED" : "RETRY";
    }
  }
}

export class ArtifactGrantService {
  public constructor(
    private readonly repository: ArtifactRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async issue(
    organizationId: string,
    artifactId: string,
    audienceMembershipId: string,
    purpose: "VIEW" | "PRINT" | "DOWNLOAD",
  ) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 5 * 60_000);
    const created = await this.repository.createGrant({
      organizationId,
      artifactId,
      audienceMembershipId,
      purpose,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt,
    });
    if (!created) throw new Error("Artifact is unavailable");
    return { token, expiresAt };
  }
  public consume(
    organizationId: string,
    artifactId: string,
    audienceMembershipId: string,
    purpose: "VIEW" | "PRINT" | "DOWNLOAD",
    token: string,
  ) {
    return this.repository.consumeGrant({
      organizationId,
      artifactId,
      audienceMembershipId,
      purpose,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      now: this.now(),
    });
  }
}

export class ArtifactOperationsService {
  public constructor(
    private readonly repository: ArtifactRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async retryGeneration(
    organizationId: string,
    artifactId: string,
    actorMembershipId: string,
  ) {
    if (
      !(await this.repository.retryGeneration({
        organizationId,
        artifactId,
        actorMembershipId,
        now: this.now(),
      }))
    )
      throw new Error("Artifact cannot be retried");
  }
  public async setLegalHold(
    organizationId: string,
    artifactId: string,
    actorMembershipId: string,
    enabled: boolean,
  ) {
    if (
      !(await this.repository.setLegalHold({
        organizationId,
        artifactId,
        actorMembershipId,
        enabled,
        now: this.now(),
      }))
    )
      throw new Error("Artifact legal hold cannot be changed");
  }
}

export class ArtifactRetentionService {
  public constructor(
    private readonly repository: ArtifactRepository,
    private readonly storage: ArtifactStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async processNext(
    workerId: string,
  ): Promise<"IDLE" | "DELETED" | "RETRY" | "FAILED"> {
    const now = this.now();
    const claim = await this.repository.claimDeletion(
      workerId,
      now,
      new Date(now.getTime() + 5 * 60_000),
    );
    if (!claim) return "IDLE";
    try {
      await this.storage.delete(claim.objectKey);
      return (await this.repository.markDeleted(claim.id, workerId, this.now()))
        ? "DELETED"
        : "FAILED";
    } catch (error) {
      const exhausted = claim.attempts >= 8;
      await this.repository.markDeletionFailure(
        claim.id,
        workerId,
        safeErrorCode(error),
        exhausted
          ? null
          : new Date(this.now().getTime() + retryDelay(claim.attempts)),
        this.now(),
      );
      return exhausted ? "FAILED" : "RETRY";
    }
  }
}

function retryDelay(attempt: number) {
  return (
    Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1)) +
    Math.floor(Math.random() * 5_000)
  );
}
function safeErrorCode(error: unknown) {
  return error instanceof Error && error.name
    ? error.name.slice(0, 100)
    : "UNKNOWN_GENERATION_ERROR";
}
