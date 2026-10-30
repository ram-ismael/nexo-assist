import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  computeDueAt,
  isWithinBusinessHours,
  parseHolidays,
  slaPolicyFor,
  slaState,
  type BusinessCalendar,
} from "@/domain/sla";

const calendar: BusinessCalendar = {
  timeZone: "America/Sao_Paulo",
  dayStartHour: 8,
  dayEndHour: 18,
  workdays: [1, 2, 3, 4, 5],
  holidays: new Set(),
};

// São Paulo is UTC-3 all year (no DST since 2019).
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("slaPolicyFor", () => {
  it("maps the PRD table", () => {
    expect(slaPolicyFor("critica", calendar)).toMatchObject({ clock: "clock", minutes: 60 });
    expect(slaPolicyFor("alta", calendar)).toMatchObject({ clock: "business", minutes: 240 });
    expect(slaPolicyFor("media", calendar)).toMatchObject({ clock: "business", minutes: 1800 });
    expect(slaPolicyFor("baixa", calendar)).toMatchObject({ clock: "business", minutes: 3000 });
  });
});

describe("computeDueAt", () => {
  const due = (start: string, priority: "critica" | "alta" | "media" | "baixa", cal = calendar) =>
    computeDueAt(sp(start), slaPolicyFor(priority, cal), cal);

  it("adds 4 business hours inside the same day", () => {
    expect(due("2026-11-03T10:00:00", "alta")).toEqual(sp("2026-11-03T14:00:00"));
  });

  it("carries the remainder to the next morning", () => {
    expect(due("2026-11-03T16:00:00", "alta")).toEqual(sp("2026-11-04T10:00:00"));
  });

  it("skips the weekend", () => {
    expect(due("2026-11-06T17:00:00", "alta")).toEqual(sp("2026-11-09T11:00:00"));
  });

  it("starts counting at opening time when opened on a weekend", () => {
    expect(due("2026-11-07T09:00:00", "alta")).toEqual(sp("2026-11-09T12:00:00"));
  });

  it("starts counting at opening time when opened before hours", () => {
    expect(due("2026-11-03T06:30:00", "alta")).toEqual(sp("2026-11-03T12:00:00"));
  });

  it("starts the next business day when opened exactly at closing time", () => {
    expect(due("2026-11-03T18:00:00", "alta")).toEqual(sp("2026-11-04T12:00:00"));
  });

  it("counts 3 business days as the same time three working days later", () => {
    expect(due("2026-11-03T10:00:00", "media")).toEqual(sp("2026-11-06T10:00:00"));
  });

  it("counts 5 business days across a weekend", () => {
    expect(due("2026-11-03T10:00:00", "baixa")).toEqual(sp("2026-11-10T10:00:00"));
  });

  it("runs critical tickets on the 24/7 clock", () => {
    expect(due("2026-11-07T03:00:00", "critica")).toEqual(sp("2026-11-07T04:00:00"));
  });

  it("skips configured holidays", () => {
    const withHoliday = { ...calendar, holidays: parseHolidays("2026-11-09") };
    expect(due("2026-11-06T17:00:00", "alta", withHoliday)).toEqual(sp("2026-11-10T11:00:00"));
  });
});

describe("addBusinessMinutes", () => {
  it("returns the start when no time is needed during business hours", () => {
    expect(addBusinessMinutes(sp("2026-11-03T09:00:00"), 0, calendar)).toEqual(
      sp("2026-11-03T09:00:00"),
    );
  });

  it("rejects negative durations", () => {
    expect(() => addBusinessMinutes(new Date(), -1, calendar)).toThrow(RangeError);
  });
});

describe("slaState", () => {
  it("reports overdue minutes", () => {
    const state = slaState(sp("2026-11-03T10:00:00"), sp("2026-11-03T11:30:00"));
    expect(state).toMatchObject({ overdue: true, overdueMinutes: 90, remainingMinutes: 0 });
  });

  it("reports remaining minutes", () => {
    const state = slaState(sp("2026-11-03T10:00:00"), sp("2026-11-03T09:00:00"));
    expect(state).toMatchObject({ overdue: false, overdueMinutes: 0, remainingMinutes: 60 });
  });
});

describe("isWithinBusinessHours", () => {
  it("knows opening hours and weekends", () => {
    expect(isWithinBusinessHours(sp("2026-11-03T08:00:00"), calendar)).toBe(true);
    expect(isWithinBusinessHours(sp("2026-11-03T18:00:00"), calendar)).toBe(false);
    expect(isWithinBusinessHours(sp("2026-11-07T10:00:00"), calendar)).toBe(false);
  });
});

describe("parseHolidays", () => {
  it("ignores malformed entries", () => {
    expect([...parseHolidays("2026-12-25, nope ,2027-01-01")]).toEqual([
      "2026-12-25",
      "2027-01-01",
    ]);
  });
});
