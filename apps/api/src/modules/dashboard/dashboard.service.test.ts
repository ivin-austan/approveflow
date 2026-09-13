import { describe, expect, it, vi } from "vitest";
import {
  DashboardService,
  type DashboardRepository,
  type DashboardRow,
} from "./dashboard.service.js";

const row: DashboardRow = {
  id: "11111111-1111-4111-8111-111111111111",
  requestNumber: "FIN-2026-0001",
  title: 'Travel, "Dubai"',
  status: "APPROVED",
  requesterMembershipId: "22222222-2222-4222-8222-222222222222",
  departmentName: "Finance",
  currentStage: "Final review",
  artifactId: "33333333-3333-4333-8333-333333333333",
  artifactStatus: "READY",
  legalHold: false,
  deliveryId: "66666666-6666-4666-8666-666666666666",
  deliveryStatus: "DELIVERED",
  updatedAt: new Date("2026-09-12T10:00:00.000Z"),
};

describe("DashboardService", () => {
  it("caps CSV exports, escapes cells, and audits the completed export", async () => {
    const exportCsv = vi.fn().mockResolvedValue([row]);
    const auditExport = vi.fn().mockResolvedValue(undefined);
    const repository: DashboardRepository = {
      list: vi.fn(),
      exportCsv,
      auditExport,
    };
    const service = new DashboardService(repository);

    const csv = await service.export(
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      row.requesterMembershipId,
      "OWN",
      { sort: "updatedAt", direction: "desc", limit: 25 },
    );

    expect(exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10_000, scope: "OWN" }),
    );
    expect(auditExport).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      row.requesterMembershipId,
      "55555555-5555-4555-8555-555555555555",
      1,
    );
    expect(csv).toContain('"Travel, ""Dubai"""');
    expect(csv).toContain("2026-09-12T10:00:00.000Z");
  });

  it("passes the permission-derived scope and filters to the repository", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ rows: [], nextCursor: null, metrics: {} });
    const repository: DashboardRepository = {
      list,
      exportCsv: vi.fn(),
      auditExport: vi.fn(),
    };
    const service = new DashboardService(repository);
    await service.list("org", "type", "member", "DEPARTMENT", {
      status: "IN_REVIEW",
      search: "travel",
      sort: "title",
      direction: "asc",
      limit: 20,
    });
    expect(list).toHaveBeenCalledWith({
      organizationId: "org",
      documentTypeId: "type",
      membershipId: "member",
      scope: "DEPARTMENT",
      status: "IN_REVIEW",
      search: "travel",
      sort: "title",
      direction: "asc",
      limit: 20,
    });
  });
});
