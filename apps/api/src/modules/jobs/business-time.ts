export interface WorkPeriod {
  /** ISO weekday: Monday = 1, Sunday = 7. */
  readonly weekday: number;
  readonly start: string;
  readonly end: string;
}

export interface CalendarHoliday {
  readonly localDate: string;
  readonly isWorkingDayOverride: boolean;
}

export interface BusinessCalendar {
  readonly timezone: string;
  readonly workPeriods: readonly WorkPeriod[];
  readonly holidays: readonly CalendarHoliday[];
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function addBusinessMinutes(
  start: Date,
  minutes: number,
  calendar: BusinessCalendar,
): Date {
  if (!Number.isSafeInteger(minutes) || minutes < 0)
    throw new Error("Business minutes must be a non-negative integer");
  assertCalendar(calendar);
  if (minutes === 0) return new Date(start);

  let remaining = minutes;
  let cursor = new Date(start);
  // Ten years protects workers from malformed calendars while allowing long SLAs.
  for (let dayOffset = 0; dayOffset < 3660; dayOffset += 1) {
    const local = localParts(cursor, calendar.timezone);
    const day = addLocalDays(local, dayOffset === 0 ? 0 : 1);
    if (dayOffset > 0)
      cursor = localToUtc(
        { ...day, hour: 0, minute: 0, second: 0 },
        calendar.timezone,
      );
    const date = localDate(day);
    const holiday = calendar.holidays.find((item) => item.localDate === date);
    const periods =
      holiday && !holiday.isWorkingDayOverride
        ? []
        : calendar.workPeriods.filter(
            (period) => period.weekday === isoWeekday(day),
          );

    for (const period of periods) {
      const intervalStart = localToUtc(
        withTime(day, period.start),
        calendar.timezone,
      );
      const intervalEnd = localToUtc(
        withTime(day, period.end),
        calendar.timezone,
      );
      const effectiveStart = cursor > intervalStart ? cursor : intervalStart;
      if (effectiveStart >= intervalEnd) continue;
      const available = Math.floor(
        (intervalEnd.getTime() - effectiveStart.getTime()) / 60_000,
      );
      if (remaining <= available)
        return new Date(effectiveStart.getTime() + remaining * 60_000);
      remaining -= available;
    }
  }
  throw new Error("Business-time calculation exceeded the supported horizon");
}

function assertCalendar(calendar: BusinessCalendar) {
  new Intl.DateTimeFormat("en-US", { timeZone: calendar.timezone }).format();
  if (calendar.workPeriods.length === 0)
    throw new Error("Business calendar has no work periods");
  for (const period of calendar.workPeriods) {
    if (period.weekday < 1 || period.weekday > 7 || period.start >= period.end)
      throw new Error("Business calendar contains an invalid work period");
  }
}

function formatter(timezone: string) {
  let value = formatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, value);
  }
  return value;
}

function localParts(date: Date, timezone: string): LocalParts {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function localToUtc(parts: LocalParts, timezone: string) {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidate), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = target - represented;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate);
  }
  throw new Error(
    "Local time does not exist in the business-calendar timezone",
  );
}

function addLocalDays(parts: LocalParts, days: number): LocalParts {
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function isoWeekday(parts: LocalParts) {
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localDate(parts: LocalParts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function withTime(parts: LocalParts, time: string): LocalParts {
  const [hour, minute, second = "0"] = time.split(":");
  return {
    ...parts,
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}
