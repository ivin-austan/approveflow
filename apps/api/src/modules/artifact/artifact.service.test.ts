import { describe, expect, it, vi } from "vitest";
import {
  ArtifactGenerationService,
  ArtifactOperationsService,
  ArtifactRetentionService,
  type ArtifactRepository,
} from "./artifact.service.js";

function repository(): {
  repository: ArtifactRepository;
  markReady: ReturnType<typeof vi.fn<ArtifactRepository["markReady"]>>;
  retryGeneration: ReturnType<
    typeof vi.fn<ArtifactRepository["retryGeneration"]>
  >;
} {
  const markReady = vi.fn<ArtifactRepository["markReady"]>(() =>
    Promise.resolve(true),
  );
  const retryGeneration = vi.fn<ArtifactRepository["retryGeneration"]>(() =>
    Promise.resolve(true),
  );
  return {
    markReady,
    retryGeneration,
    repository: {
      claimGeneration: vi.fn(() =>
        Promise.resolve({
          id: "artifact",
          organizationId: "org",
          requestId: "request",
          objectKey: "org/request.pdf",
          attempts: 1,
          model: {
            requestNumber: "REQ-1",
            title: "Laptop",
            workflowName: "Purchase",
            approvedAt: "2026-01-01T00:00:00.000Z",
            fields: [],
            decisions: [],
          },
        }),
      ),
      markReady,
      markGenerationFailure: vi.fn(() => Promise.resolve(true)),
      createGrant: vi.fn(() => Promise.resolve(true)),
      consumeGrant: vi.fn(() => Promise.resolve(null)),
      retryGeneration,
      claimDeletion: vi.fn(() => Promise.resolve(null)),
      markDeleted: vi.fn(() => Promise.resolve(true)),
      markDeletionFailure: vi.fn(() => Promise.resolve(true)),
      setLegalHold: vi.fn(() => Promise.resolve(true)),
    },
  };
}
describe("ArtifactGenerationService", () => {
  it("performs rendering and storage after claiming, then records the canonical hash", async () => {
    const state = repository();
    const put = vi.fn(() => Promise.resolve());
    const service = new ArtifactGenerationService(
      state.repository,
      {
        put,
        get: vi.fn(() => Promise.resolve(new Uint8Array())),
        delete: vi.fn(() => Promise.resolve()),
      },
      { render: () => new Uint8Array([1, 2, 3]) },
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    await expect(service.processNext("worker-1")).resolves.toBe("READY");
    expect(put).toHaveBeenCalledWith(
      "org/request.pdf",
      new Uint8Array([1, 2, 3]),
    );
    const call = state.markReady.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Artifact was not marked ready");
    expect(call[0].sha256).toHaveLength(64);
    expect(call[0].sizeBytes).toBe(3n);
  });

  it("passes the operator identity to a manual generation retry", async () => {
    const state = repository();
    const service = new ArtifactOperationsService(
      state.repository,
      () => new Date("2026-01-02T00:00:00.000Z"),
    );
    await service.retryGeneration("org", "artifact", "operator");
    expect(state.retryGeneration).toHaveBeenCalledWith({
      organizationId: "org",
      artifactId: "artifact",
      actorMembershipId: "operator",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
  });

  it("deletes only an artifact claimed by the retention repository", async () => {
    const state = repository();
    state.repository.claimDeletion = vi.fn(() =>
      Promise.resolve({
        id: "artifact",
        objectKey: "org/request.pdf",
        attempts: 1,
      }),
    );
    const remove = vi.fn(() => Promise.resolve());
    const service = new ArtifactRetentionService(
      state.repository,
      { put: vi.fn(), get: vi.fn(), delete: remove },
      () => new Date("2033-01-01T00:00:00.000Z"),
    );
    await expect(service.processNext("retention-worker")).resolves.toBe(
      "DELETED",
    );
    expect(remove).toHaveBeenCalledWith("org/request.pdf");
  });
});
