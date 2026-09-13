export interface TimelineResult {
  request: {
    id: string;
    requestNumber: string | null;
    title: string;
    status: string;
    revision: number;
  };
  stages: readonly {
    id: string;
    levelNumber: number;
    name: string;
    status: string;
    isFinal: boolean;
    activatedAt: Date | null;
    dueAt: Date | null;
    completedAt: Date | null;
    tasks: readonly {
      id: string;
      assigneeName: string;
      status: string;
      activatedAt: Date | null;
      decidedAt: Date | null;
    }[];
  }[];
  events: readonly {
    id: string;
    eventType: string;
    payload: Readonly<Record<string, unknown>>;
    occurredAt: Date;
  }[];
}

export interface AuditRepository {
  timeline(input: {
    organizationId: string;
    requestId: string;
    membershipId: string;
    canReadAll: boolean;
    canReadAssigned: boolean;
  }): Promise<TimelineResult | null>;
}
export class TimelineNotFoundError extends Error {}

export class AuditService {
  public constructor(private readonly repository: AuditRepository) {}
  public async timeline(
    organizationId: string,
    requestId: string,
    membershipId: string,
    canReadAll: boolean,
    canReadAssigned: boolean,
  ) {
    const result = await this.repository.timeline({
      organizationId,
      requestId,
      membershipId,
      canReadAll,
      canReadAssigned,
    });
    if (!result) throw new TimelineNotFoundError("Timeline not found");
    return {
      ...result,
      events: result.events.map((event) => ({
        ...event,
        payload: sanitizePayload(event.payload),
      })),
    };
  }
}

export function sanitizePayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const sensitive = /email|token|password|secret|objectkey|storagekey/i;
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => !sensitive.test(key))
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.map((item) => sanitizeValue(item, sensitive))
          : sanitizeValue(value, sensitive),
      ]),
  );
}

function sanitizeValue(value: unknown, sensitive: RegExp): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value))
    return value.map((item) => sanitizeValue(item, sensitive));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitive.test(key))
      .map(([key, item]) => [key, sanitizeValue(item, sensitive)]),
  );
}
