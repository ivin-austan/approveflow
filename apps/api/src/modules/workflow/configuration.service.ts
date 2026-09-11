import { randomUUID } from "node:crypto";
import type {
  BusinessCalendarInput,
  DocumentTypeInput,
} from "./configuration.schemas.js";

const numberTokens = new Set([
  "DEPARTMENT_CODE",
  "DOCUMENT_TYPE_CODE",
  "YEAR",
  "SEQUENCE",
]);

export class ConfigurationValidationError extends Error {}
export class ConfigurationReferenceError extends Error {}
export class ConfigurationRevisionConflictError extends Error {}

export interface BusinessCalendarSummary {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly revision: number;
  readonly isDefault: boolean;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface DocumentTypeSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly businessCalendarId: string;
  readonly numberFormat: string;
  readonly sequencePadding: number;
}

export interface WorkflowConfigurationRepository {
  listBusinessCalendars(
    organizationId: string,
  ): Promise<readonly BusinessCalendarSummary[]>;
  listDocumentTypes(
    organizationId: string,
  ): Promise<readonly DocumentTypeSummary[]>;
  saveBusinessCalendar(
    input: BusinessCalendarInput & {
      readonly id: string;
      readonly organizationId: string;
    },
  ): Promise<"SAVED" | "CONFLICT">;
  createDocumentType(
    input: Omit<DocumentTypeInput, "automaticApproval"> & {
      readonly id: string;
      readonly organizationId: string;
      readonly code: string;
      readonly automaticApprovalEnabled: boolean;
      readonly automaticApprovalDuration: number | null;
      readonly automaticApprovalDurationUnit:
        "BUSINESS_HOURS" | "BUSINESS_DAYS" | null;
    },
  ): Promise<boolean>;
}

export class WorkflowConfigurationService {
  public constructor(
    private readonly repository: WorkflowConfigurationRepository,
  ) {}

  public listBusinessCalendars(organizationId: string) {
    return this.repository.listBusinessCalendars(organizationId);
  }

  public listDocumentTypes(organizationId: string) {
    return this.repository.listDocumentTypes(organizationId);
  }

  public async saveBusinessCalendar(
    organizationId: string,
    input: BusinessCalendarInput,
    calendarId?: string,
  ) {
    assertTimezone(input.timezone);
    assertPeriodsDoNotOverlap(input.workPeriods);
    const id = calendarId ?? randomUUID();
    const result = await this.repository.saveBusinessCalendar({
      ...input,
      id,
      organizationId,
    });
    if (result === "CONFLICT")
      throw new ConfigurationRevisionConflictError(
        "The calendar was changed by another editor",
      );
    return { id };
  }

  public async createDocumentType(
    organizationId: string,
    input: DocumentTypeInput,
  ) {
    assertNumberFormat(input.numberFormat);
    const id = randomUUID();
    const created = await this.repository.createDocumentType({
      ...input,
      id,
      organizationId,
      code: input.code.toUpperCase(),
      automaticApprovalEnabled: input.automaticApproval.enabled,
      automaticApprovalDuration: input.automaticApproval.enabled
        ? input.automaticApproval.after.value
        : null,
      automaticApprovalDurationUnit: input.automaticApproval.enabled
        ? input.automaticApproval.after.unit
        : null,
    });
    if (!created)
      throw new ConfigurationReferenceError("Business calendar not found");
    return { id };
  }
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new ConfigurationValidationError(
      "Timezone must be a valid IANA timezone",
    );
  }
}

function assertPeriodsDoNotOverlap(
  periods: BusinessCalendarInput["workPeriods"],
): void {
  const ordered = [...periods].sort(
    (a, b) =>
      a.weekday - b.weekday || a.localStartTime.localeCompare(b.localStartTime),
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    if (
      previous.weekday === current.weekday &&
      current.localStartTime < previous.localEndTime
    )
      throw new ConfigurationValidationError(
        "Business-calendar work periods must not overlap",
      );
  }
}

function assertNumberFormat(format: string): void {
  const tokens = [...format.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  if (
    tokens.some((token) => !token || !numberTokens.has(token)) ||
    !tokens.includes("SEQUENCE") ||
    !tokens.includes("YEAR")
  )
    throw new ConfigurationValidationError(
      "Number format contains unsupported or missing components",
    );
  if (/[{}]/.exec(format.replace(/\{[^{}]+\}/g, "")))
    throw new ConfigurationValidationError(
      "Number format contains malformed components",
    );
}
