import { describe, expect, it, vi } from "vitest";
import {
  DeliveryOperationsService,
  DeliveryService,
  type DeliveryClaim,
  type DeliveryRepository,
  type EmailProvider,
} from "./delivery.service.js";

const claim: DeliveryClaim = {
  id: "delivery",
  organizationId: "org",
  requestId: "request",
  artifactId: "artifact",
  objectKey: "org/request.pdf",
  sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
  sizeBytes: 3n,
  recipientEmail: "user@example.com",
  providerIdempotencyKey: "provider-key",
  mode: "ATTACHMENT",
  attempts: 1,
  eligible: true,
};
function setup(overrides: Partial<DeliveryClaim> = {}) {
  const accepted = vi.fn<DeliveryRepository["accepted"]>(() =>
    Promise.resolve(true),
  );
  const retry = vi.fn<DeliveryRepository["retry"]>(() => Promise.resolve(true));
  const linkOnly = vi.fn<DeliveryRepository["linkOnly"]>(() =>
    Promise.resolve(true),
  );
  const reopen = vi.fn<DeliveryRepository["reopen"]>(() =>
    Promise.resolve(true),
  );
  const repository: DeliveryRepository = {
    claim: vi.fn(() => Promise.resolve({ ...claim, ...overrides })),
    accepted,
    retry,
    linkOnly,
    reopen,
  };
  const send = vi.fn<EmailProvider["send"]>(() =>
    Promise.resolve({ status: "ACCEPTED", messageId: "message" }),
  );
  const provider: EmailProvider = {
    send,
    reconcile: vi.fn(() => Promise.resolve({ status: "NOT_FOUND" as const })),
  };
  return { repository, provider, accepted, retry, linkOnly, reopen, send };
}
describe("DeliveryService", () => {
  it("verifies canonical bytes and sends one idempotent attachment", async () => {
    const state = setup();
    const service = new DeliveryService(
      state.repository,
      { get: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))) },
      state.provider,
    );
    await expect(service.processNext("worker")).resolves.toBe("ACCEPTED");
    const call = state.send.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Provider was not called");
    expect(call[0].idempotencyKey).toBe("provider-key");
    expect(call[0].attachment).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("uses link-only mode above the attachment limit without embedding a token", async () => {
    const state = setup({ sizeBytes: 11n });
    const service = new DeliveryService(
      state.repository,
      { get: vi.fn(() => Promise.reject(new Error("must not read"))) },
      state.provider,
      10,
    );
    await expect(service.processNext("worker")).resolves.toBe("ACCEPTED");
    expect(state.linkOnly).toHaveBeenCalled();
    const call = state.send.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Provider was not called");
    expect(call[0].attachment).toBeNull();
    expect(call[0].body).not.toMatch(/token|bearer/i);
  });
  it("never contacts the provider for an ineligible recipient", async () => {
    const state = setup({ eligible: false });
    await expect(
      new DeliveryService(
        state.repository,
        { get: vi.fn(() => Promise.resolve(new Uint8Array())) },
        state.provider,
      ).processNext("worker"),
    ).resolves.toBe("FAILED");
    expect(state.send).not.toHaveBeenCalled();
    expect(state.retry).toHaveBeenCalled();
  });
  it("reopens the same logical delivery with the operator identity", async () => {
    const state = setup();
    const service = new DeliveryOperationsService(
      state.repository,
      () => new Date("2026-09-12T12:00:00.000Z"),
    );
    await service.reopen("org", "delivery", "operator");
    expect(state.reopen).toHaveBeenCalledWith({
      organizationId: "org",
      deliveryId: "delivery",
      actorMembershipId: "operator",
      now: new Date("2026-09-12T12:00:00.000Z"),
    });
  });
});
