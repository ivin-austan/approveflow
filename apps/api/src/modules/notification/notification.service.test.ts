import { describe, expect, it, vi } from "vitest";
import type { EmailProvider } from "../delivery/delivery.service.js";
import {
  NotificationService,
  type NotificationRepository,
} from "./notification.service.js";

function setup(eligible = true) {
  const accepted = vi.fn<NotificationRepository["accepted"]>(() =>
    Promise.resolve(true),
  );
  const retry = vi.fn<NotificationRepository["retry"]>(() =>
    Promise.resolve(true),
  );
  const repository: NotificationRepository = {
    prepareStageEvent: vi.fn(() => Promise.resolve(1)),
    claim: vi.fn(() =>
      Promise.resolve({
        id: "delivery",
        recipientEmail: "reviewer@example.com",
        subject: "Purchase PUR-1: Finance",
        body: "Review Document: https://app.example/sign-in?returnTo=%2Forganizations%2Forg%2Fapprovals",
        providerIdempotencyKey: "notification:event:member",
        attempts: 1,
        eligible,
      }),
    ),
    accepted,
    retry,
  };
  const send = vi.fn<EmailProvider["send"]>(() =>
    Promise.resolve({ status: "ACCEPTED", messageId: "provider-message" }),
  );
  const provider: EmailProvider = {
    send,
    reconcile: vi.fn(() => Promise.resolve({ status: "NOT_FOUND" as const })),
  };
  return { repository, provider, accepted, retry, send };
}

describe("NotificationService", () => {
  it("sends link-only stage mail with a stable provider key", async () => {
    const state = setup();
    const service = new NotificationService(
      state.repository,
      state.provider,
      "https://app.example",
    );
    await expect(service.processNext("worker")).resolves.toBe("ACCEPTED");
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: null,
        idempotencyKey: "notification:event:member",
      }),
    );
    const sent = state.send.mock.calls[0]?.[0];
    expect(sent?.body).not.toMatch(/bearer|access_token|refresh_token/i);
  });

  it("does not contact the provider for an ineligible membership", async () => {
    const state = setup(false);
    const service = new NotificationService(
      state.repository,
      state.provider,
      "https://app.example",
    );
    await expect(service.processNext("worker")).resolves.toBe("FAILED");
    expect(state.send).not.toHaveBeenCalled();
    expect(state.retry).toHaveBeenCalledWith(
      "delivery",
      "worker",
      "PERMANENTLY_FAILED",
      "RECIPIENT_INELIGIBLE",
      null,
      expect.any(Date),
    );
  });
});
