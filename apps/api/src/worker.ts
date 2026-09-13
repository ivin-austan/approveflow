import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { parseServerEnvironment } from "@approveflow/config";
import { createDatabase } from "@approveflow/database";
import { renderApprovedPdf } from "@approveflow/pdf";
import { DrizzleArtifactRepository } from "./modules/artifact/artifact.repository.js";
import {
  ArtifactGenerationService,
  ArtifactRetentionService,
} from "./modules/artifact/artifact.service.js";
import { FileSystemArtifactStorage } from "./modules/artifact/filesystem.storage.js";
import { BullMqPublisher } from "./modules/jobs/bullmq.publisher.js";
import { DrizzleOutboxRepository } from "./modules/jobs/outbox.repository.js";
import { OutboxDispatcher } from "./modules/jobs/outbox.service.js";
import { StageSchedulerRepository } from "./modules/jobs/stage-scheduler.repository.js";
import { ScheduledActionRepository } from "./modules/jobs/scheduled-action.repository.js";
import { DrizzleNotificationRepository } from "./modules/notification/notification.repository.js";
import { NotificationService } from "./modules/notification/notification.service.js";
import { DeliveryService } from "./modules/delivery/delivery.service.js";
import { DrizzleDeliveryRepository } from "./modules/delivery/delivery.repository.js";
import { HttpEmailProvider } from "./modules/delivery/http-email.provider.js";

const environment = parseServerEnvironment(process.env);
const { db, close } = createDatabase(environment.DATABASE_URL);
const redis = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("approveflow-events", { connection: redis });
const artifactRepository = new DrizzleArtifactRepository(db);
const artifactStorage = new FileSystemArtifactStorage(
  environment.ARTIFACT_STORAGE_PATH,
);
const artifacts = new ArtifactGenerationService(
  artifactRepository,
  artifactStorage,
  { render: renderApprovedPdf },
);
const retention = new ArtifactRetentionService(
  artifactRepository,
  artifactStorage,
);
const emailProvider =
  environment.EMAIL_PROVIDER_URL && environment.EMAIL_PROVIDER_API_KEY
    ? new HttpEmailProvider(
        environment.EMAIL_PROVIDER_URL,
        environment.EMAIL_PROVIDER_API_KEY,
      )
    : null;
const delivery = emailProvider
  ? new DeliveryService(
      new DrizzleDeliveryRepository(db),
      artifactStorage,
      emailProvider,
      10 * 1024 * 1024,
      environment.WEB_ORIGIN,
    )
  : null;
const notifications = emailProvider
  ? new NotificationService(
      new DrizzleNotificationRepository(db),
      emailProvider,
      environment.WEB_ORIGIN,
    )
  : null;
const dispatcher = new OutboxDispatcher(
  new DrizzleOutboxRepository(db),
  new BullMqPublisher(queue),
);
const stageScheduler = new StageSchedulerRepository(db);
const scheduledActions = new ScheduledActionRepository(db);
const stageEvent = z.object({
  runtimeStageId: z.uuid(),
  recipientPolicy: z.record(z.string(), z.unknown()).nullish(),
});
const worker = new Worker(
  "approveflow-events",
  async (job) => {
    if (job.name === "APPROVED_ARTIFACT_GENERATION_REQUESTED")
      await artifacts.processNext(`artifact-${randomUUID()}`);
    if (job.name === "APPROVED_ARTIFACT_READY" && delivery)
      await delivery.processNext(`delivery-${randomUUID()}`);
    if (
      notifications &&
      [
        "STAGE_ACTIVATED",
        "STAGE_REMINDER_DUE",
        "STAGE_ESCALATION_NOTIFICATION_DUE",
      ].includes(job.name)
    ) {
      const data = stageEvent.parse(job.data);
      await notifications.prepareStageEvent(
        String(job.id),
        data.runtimeStageId,
        job.name,
        data.recipientPolicy,
      );
    }
  },
  { connection: redis, concurrency: 4 },
);
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (let count = 0; count < 50; count += 1)
      if (!(await stageScheduler.scheduleNext(new Date()))) break;
    for (let count = 0; count < 50; count += 1)
      if (!(await scheduledActions.processNext(new Date()))) break;
    if (notifications)
      for (let count = 0; count < 50; count += 1)
        if (
          (await notifications.processNext(`notification-${randomUUID()}`)) ===
          "IDLE"
        )
          break;
    for (let count = 0; count < 10; count += 1)
      if ((await retention.processNext(`retention-${randomUUID()}`)) === "IDLE")
        break;
    await dispatcher.dispatch();
  } finally {
    ticking = false;
  }
}
const timer = setInterval(() => {
  void tick().catch(reportWorkerError);
}, 1_000);
void tick().catch(reportWorkerError);

function reportWorkerError(error: unknown) {
  const message = error instanceof Error ? error.name : "UNKNOWN_WORKER_ERROR";
  process.stderr.write(`ApproveFlow worker tick failed: ${message}\n`);
}

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  redis.disconnect();
  await close();
}
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
