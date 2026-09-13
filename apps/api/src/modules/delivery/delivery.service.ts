import { createHash } from "node:crypto";

export interface DeliveryClaim {
  id: string;
  organizationId: string;
  requestId: string;
  artifactId: string;
  objectKey: string;
  sha256: string;
  sizeBytes: bigint;
  recipientEmail: string;
  providerIdempotencyKey: string;
  mode: "ATTACHMENT" | "LINK_ONLY";
  attempts: number;
  eligible: boolean;
}
export interface DeliveryRepository {
  claim(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<DeliveryClaim | null>;
  accepted(
    id: string,
    workerId: string,
    providerMessageId: string,
    now: Date,
  ): Promise<boolean>;
  retry(
    id: string,
    workerId: string,
    status: "RECONCILING" | "RETRY_SCHEDULED" | "PERMANENTLY_FAILED",
    errorCode: string,
    nextAttemptAt: Date | null,
    now: Date,
  ): Promise<boolean>;
  linkOnly(
    id: string,
    workerId: string,
    reason: "SIZE_LIMIT",
    now: Date,
  ): Promise<boolean>;
  reopen(input: {
    organizationId: string;
    deliveryId: string;
    actorMembershipId: string;
    now: Date;
  }): Promise<boolean>;
}
export interface DeliveryStorage {
  get(key: string): Promise<Uint8Array>;
}
export interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    body: string;
    attachment: Uint8Array | null;
    idempotencyKey: string;
  }): Promise<
    | { status: "ACCEPTED"; messageId: string }
    | { status: "UNKNOWN" }
    | { status: "REJECTED"; code: string }
  >;
  reconcile(
    idempotencyKey: string,
  ): Promise<
    | { status: "ACCEPTED"; messageId: string }
    | { status: "NOT_FOUND" }
    | { status: "REJECTED"; code: string }
  >;
}
export class DeliveryService {
  public constructor(
    private readonly repository: DeliveryRepository,
    private readonly storage: DeliveryStorage,
    private readonly provider: EmailProvider,
    private readonly attachmentLimitBytes = 10 * 1024 * 1024,
    private readonly webOrigin = "",
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async processNext(
    workerId: string,
  ): Promise<"IDLE" | "ACCEPTED" | "RETRY" | "FAILED"> {
    const now = this.now();
    const claim = await this.repository.claim(
      workerId,
      now,
      new Date(now.getTime() + 5 * 60_000),
    );
    if (!claim) return "IDLE";
    if (!claim.eligible) {
      await this.repository.retry(
        claim.id,
        workerId,
        "PERMANENTLY_FAILED",
        "RECIPIENT_INELIGIBLE",
        null,
        this.now(),
      );
      return "FAILED";
    }
    if (claim.attempts > 1) {
      const reconciled = await this.provider.reconcile(
        claim.providerIdempotencyKey,
      );
      if (reconciled.status === "ACCEPTED") {
        await this.repository.accepted(
          claim.id,
          workerId,
          reconciled.messageId,
          this.now(),
        );
        return "ACCEPTED";
      }
      if (reconciled.status === "REJECTED") {
        await this.repository.retry(
          claim.id,
          workerId,
          "PERMANENTLY_FAILED",
          reconciled.code,
          null,
          this.now(),
        );
        return "FAILED";
      }
    }
    try {
      const linkOnly =
        claim.mode === "LINK_ONLY" ||
        claim.sizeBytes > BigInt(this.attachmentLimitBytes);
      if (claim.mode === "ATTACHMENT" && linkOnly)
        await this.repository.linkOnly(
          claim.id,
          workerId,
          "SIZE_LIMIT",
          this.now(),
        );
      const bytes = linkOnly ? null : await this.storage.get(claim.objectKey);
      if (
        bytes &&
        createHash("sha256").update(bytes).digest("hex") !== claim.sha256
      )
        throw new Error("ARTIFACT_HASH_MISMATCH");
      const result = await this.provider.send({
        to: claim.recipientEmail,
        subject: "Your approved document is ready",
        body: linkOnly
          ? `Sign in to ApproveFlow to securely review your approved document.\nReview Document: ${this.webOrigin}/sign-in?returnTo=${encodeURIComponent(`/organizations/${claim.organizationId}/requests/${claim.requestId}`)}`
          : "Your canonical approved document is attached.",
        attachment: bytes,
        idempotencyKey: claim.providerIdempotencyKey,
      });
      if (result.status === "ACCEPTED") {
        await this.repository.accepted(
          claim.id,
          workerId,
          result.messageId,
          this.now(),
        );
        return "ACCEPTED";
      }
      if (result.status === "REJECTED") {
        await this.repository.retry(
          claim.id,
          workerId,
          "PERMANENTLY_FAILED",
          result.code,
          null,
          this.now(),
        );
        return "FAILED";
      }
      await this.repository.retry(
        claim.id,
        workerId,
        "RECONCILING",
        "PROVIDER_ACCEPTANCE_UNKNOWN",
        new Date(this.now().getTime() + 60_000),
        this.now(),
      );
      return "RETRY";
    } catch (error) {
      const exhausted = claim.attempts >= 8;
      await this.repository.retry(
        claim.id,
        workerId,
        exhausted ? "PERMANENTLY_FAILED" : "RETRY_SCHEDULED",
        error instanceof Error ? error.message.slice(0, 100) : "DELIVERY_ERROR",
        exhausted
          ? null
          : new Date(
              this.now().getTime() +
                30_000 * 2 ** Math.max(0, claim.attempts - 1),
            ),
        this.now(),
      );
      return exhausted ? "FAILED" : "RETRY";
    }
  }
}

export class DeliveryOperationsService {
  public constructor(
    private readonly repository: DeliveryRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async reopen(
    organizationId: string,
    deliveryId: string,
    actorMembershipId: string,
  ) {
    if (
      !(await this.repository.reopen({
        organizationId,
        deliveryId,
        actorMembershipId,
        now: this.now(),
      }))
    )
      throw new Error("Delivery cannot be reopened");
  }
}
