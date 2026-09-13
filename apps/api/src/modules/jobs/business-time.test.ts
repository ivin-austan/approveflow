import { describe, expect, it } from "vitest";
import { addBusinessMinutes, type BusinessCalendar } from "./business-time.js";

const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00:00",
  end: "17:00:00",
}));

describe("addBusinessMinutes", () => {
  it("skips holidays and preserves the calendar timezone", () => {
    const calendar: BusinessCalendar = {
      timezone: "Asia/Dubai",
      workPeriods: weekdays,
      holidays: [{ localDate: "2026-09-14", isWorkingDayOverride: false }],
    };
    // Friday 16:00 Dubai + two working hours => Tuesday 10:00 Dubai.
    expect(
      addBusinessMinutes(
        new Date("2026-09-11T12:00:00.000Z"),
        120,
        calendar,
      ).toISOString(),
    ).toBe("2026-09-15T06:00:00.000Z");
  });

  it("handles a daylight-saving boundary using local work periods", () => {
    const calendar: BusinessCalendar = {
      timezone: "America/New_York",
      workPeriods: weekdays,
      holidays: [],
    };
    // Friday before DST begins + two working hours => Monday 10:00 EDT.
    expect(
      addBusinessMinutes(
        new Date("2026-03-06T21:00:00.000Z"),
        120,
        calendar,
      ).toISOString(),
    ).toBe("2026-03-09T14:00:00.000Z");
  });

  it("starts at the next work period when activated out of hours", () => {
    const calendar: BusinessCalendar = {
      timezone: "Asia/Dubai",
      workPeriods: weekdays,
      holidays: [],
    };
    expect(
      addBusinessMinutes(
        new Date("2026-09-13T18:00:00.000Z"),
        30,
        calendar,
      ).toISOString(),
    ).toBe("2026-09-14T05:30:00.000Z");
  });
});
