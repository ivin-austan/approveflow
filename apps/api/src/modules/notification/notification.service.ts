import type { EmailProvider } from "../delivery/delivery.service.js";

export interface NotificationClaim {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  providerIdempotencyKey: string;
  attempts: number;
  eligible: boolean;
}

export interface NotificationRepository {
  prepareStageEvent(input: {
    sourceEventId: string;
    runtimeStageId: string;
    eventType: string;
    recipientPolicy?: Readonly<Record<string, unknown>> | null;
    webOrigin: string;
    now: Date;
  }): Promise<number>;
  claim(
    workerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<NotificationClaim | null>;
  accepted(
    id: string,
    workerId: string,
    messageId: string,
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
}

export class NotificationService {
  public constructor(
    private readonly repository: NotificationRepository,
    private readonly provider: EmailProvider,
    private readonly webOrigin: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public prepareStageEvent(
    sourceEventId: string,
    runtimeStageId: string,
    eventType: string,
    recipientPolicy?: Readonly<Record<string, unknown>> | null,
  ) {
    return this.repository.prepareStageEvent({
      sourceEventId,
      runtimeStageId,
      eventType,
      ...(recipientPolicy === undefined ? {} : { recipientPolicy }),
      webOrigin: this.webOrigin,
      now: this.now(),
    });
  }

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
      const result = await this.provider.reconcile(
        claim.providerIdempotencyKey,
      );
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
    }
    try {
      const result = await this.provider.send({
        to: claim.recipientEmail,
        subject: claim.subject,
        body: claim.body,
        attachment: null,
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
        error instanceof Error
          ? error.name.slice(0, 100)
          : "NOTIFICATION_ERROR",
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
