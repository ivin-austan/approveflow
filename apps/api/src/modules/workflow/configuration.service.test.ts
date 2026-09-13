import { describe, expect, it, vi } from "vitest";
import {
  ConfigurationValidationError,
  WorkflowConfigurationService,
  type WorkflowConfigurationRepository,
} from "./configuration.service.js";

const repository = (
  overrides: Partial<WorkflowConfigurationRepository> = {},
): WorkflowConfigurationRepository => ({
  listBusinessCalendars: () => Promise.resolve([]),
  listDocumentTypes: () => Promise.resolve([]),
  saveBusinessCalendar: () => Promise.resolve("SAVED"),
  createDocumentType: () => Promise.resolve(true),
  ...overrides,
});

describe("WorkflowConfigurationService", () => {
  it("rejects invalid timezones and overlapping work periods", async () => {
    const service = new WorkflowConfigurationService(repository());
    await expect(
      service.saveBusinessCalendar("o", {
        name: "Office",
        timezone: "Mars/Olympus",
        isDefault: true,
        workPeriods: [
          { weekday: 1, localStartTime: "09:00", localEndTime: "17:00" },
        ],
        holidays: [],
      }),
    ).rejects.toBeInstanceOf(ConfigurationValidationError);
    await expect(
      service.saveBusinessCalendar("o", {
        name: "Office",
        timezone: "Asia/Dubai",
        isDefault: true,
        workPeriods: [
          { weekday: 1, localStartTime: "09:00", localEndTime: "13:00" },
          { weekday: 1, localStartTime: "12:00", localEndTime: "17:00" },
        ],
        holidays: [],
      }),
    ).rejects.toBeInstanceOf(ConfigurationValidationError);
  });

  it("normalizes codes and accepts allowlisted numbering tokens", async () => {
    const createDocumentType = vi.fn<
      WorkflowConfigurationRepository["createDocumentType"]
    >(() => Promise.resolve(true));
    const service = new WorkflowConfigurationService(
      repository({ createDocumentType }),
    );
    await service.createDocumentType("o", {
      name: "Invoice",
      code: "inv",
      businessCalendarId: "11111111-1111-4111-8111-111111111111",
      numberFormat: "{DEPARTMENT_CODE}/{DOCUMENT_TYPE_CODE}/{YEAR}/{SEQUENCE}",
      sequencePadding: 6,
      approvedPdfRetentionYears: 7,
      approvedPdfFieldPolicy: {
        includeAllSubmittedFields: true,
        excludedFieldIds: [],
      },
      finalRecipientMembershipIds: [],
      automaticApproval: { enabled: false },
    });
    expect(createDocumentType.mock.calls[0]?.[0].code).toBe("INV");
  });

  it("rejects unknown and incomplete numbering formats", async () => {
    const service = new WorkflowConfigurationService(repository());
    const input = {
      name: "Invoice",
      code: "INV",
      businessCalendarId: "11111111-1111-4111-8111-111111111111",
      sequencePadding: 6,
      approvedPdfRetentionYears: 7,
      approvedPdfFieldPolicy: {
        includeAllSubmittedFields: true,
        excludedFieldIds: [],
      },
      finalRecipientMembershipIds: [],
      automaticApproval: { enabled: false } as const,
    };
    await expect(
      service.createDocumentType("o", {
        ...input,
        numberFormat: "{YEAR}/{SCRIPT}",
      }),
    ).rejects.toBeInstanceOf(ConfigurationValidationError);
  });
});
