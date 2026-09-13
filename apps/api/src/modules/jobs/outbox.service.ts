export interface OutboxMessage {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Readonly<Record<string, unknown>>;
}
export interface OutboxRepository {
  claim(
    now: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<readonly OutboxMessage[]>;
  published(id: string, now: Date): Promise<void>;
  failed(
    id: string,
    errorCode: string,
    retryAt: Date,
    now: Date,
  ): Promise<void>;
}
export interface JobPublisher {
  publish(message: OutboxMessage): Promise<void>;
}
export class OutboxDispatcher {
  public constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: JobPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async dispatch(limit = 50): Promise<number> {
    const now = this.now();
    const messages = await this.repository.claim(
      now,
      new Date(now.getTime() - 5 * 60_000),
      limit,
    );
    for (const message of messages) {
      try {
        await this.publisher.publish(message);
        await this.repository.published(message.id, this.now());
      } catch (error) {
        await this.repository.failed(
          message.id,
          error instanceof Error ? error.name.slice(0, 100) : "PUBLISH_ERROR",
          new Date(this.now().getTime() + 30_000),
          this.now(),
        );
      }
    }
    return messages.length;
  }
}
