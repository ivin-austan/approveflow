import type { Queue } from "bullmq";
import type { JobPublisher, OutboxMessage } from "./outbox.service.js";

export class BullMqPublisher implements JobPublisher {
  public constructor(private readonly queue: Queue) {}
  public async publish(message: OutboxMessage): Promise<void> {
    await this.queue.add(
      message.eventType,
      { aggregateId: message.aggregateId, ...message.payload },
      {
        jobId: message.id,
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
  }
}
