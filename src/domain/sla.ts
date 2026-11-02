import { TZDate } from "@date-fns/tz";
import type { Priority } from "./tickets";

export type BusinessCalendar = {
  timeZone: string;
  /** Hour (0-23) the service desk opens, in the calendar time zone. */
  dayStartHour: number;
  /** Hour (1-24) the service desk closes, in the calendar time zone. */
  dayEndHour: number;
  /** ISO weekday numbers that are working days (1 = Monday ... 7 = Sunday). */
  workdays: readonly number[];
  /** Holidays as YYYY-MM-DD in the calendar time zone. */
  holidays: ReadonlySet<string>;
};

export type SlaPolicy = {
  priority: Priority;
  /** "clock" runs 24/7 (critical on-call); "business" only counts open hours. */
  clock: "clock" | "business";
  minutes: number;
  label: string;
};

/**
 * PRD (Anexo A). Business days are counted as full service-desk days, so with
 * an 08:00-18:00 calendar "3 dias úteis" is 30 business hours: a ticket opened
 * Monday 10:00 is due Thursday 10:00.
 */
export function slaPolicyFor(priority: Priority, calendar: BusinessCalendar): SlaPolicy {
  const dayMinutes = (calendar.dayEndHour - calendar.dayStartHour) * 60;
  switch (priority) {
    case "critica":
      return { priority, clock: "clock", minutes: 60, label: "1 hora" };
    case "alta":
      return { priority, clock: "business", minutes: 4 * 60, label: "4 horas úteis" };
    case "media":
      return { priority, clock: "business", minutes: 3 * dayMinutes, label: "3 dias úteis" };
    case "baixa":
      return { priority, clock: "business", minutes: 5 * dayMinutes, label: "5 dias úteis" };
  }
}

function dateKey(date: TZDate): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoWeekday(date: TZDate): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function isBusinessDay(date: TZDate, calendar: BusinessCalendar): boolean {
  return calendar.workdays.includes(isoWeekday(date)) && !calendar.holidays.has(dateKey(date));
}

function atHour(date: TZDate, hour: number, calendar: BusinessCalendar): TZDate {
  return new TZDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    0,
    0,
    0,
    calendar.timeZone,
  );
}

function nextDayStart(date: TZDate, calendar: BusinessCalendar): TZDate {
  const next = new TZDate(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
    calendar.dayStartHour,
    0,
    0,
    0,
    calendar.timeZone,
  );
  return next;
}

/** Adds working minutes, skipping nights, weekends and holidays. */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar): Date {
  if (minutes < 0) throw new RangeError("minutes must be non-negative");
  let cursor = new TZDate(start.getTime(), calendar.timeZone);
  let remaining = minutes;

  // Bounded: a year of iterations covers any SLA defined in the PRD.
  for (let guard = 0; guard < 400; guard += 1) {
    if (!isBusinessDay(cursor, calendar)) {
      cursor = nextDayStart(cursor, calendar);
      continue;
    }
    const open = atHour(cursor, calendar.dayStartHour, calendar);
    const close = atHour(cursor, calendar.dayEndHour, calendar);
    if (cursor.getTime() < open.getTime()) cursor = open;
    if (cursor.getTime() >= close.getTime()) {
      cursor = nextDayStart(cursor, calendar);
      continue;
    }
    const available = (close.getTime() - cursor.getTime()) / 60_000;
    if (remaining <= available) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= available;
    cursor = nextDayStart(cursor, calendar);
  }
  throw new RangeError("SLA calculation exceeded the supported horizon");
}

export function computeDueAt(startedAt: Date, policy: SlaPolicy, calendar: BusinessCalendar): Date {
  if (policy.clock === "clock") return new Date(startedAt.getTime() + policy.minutes * 60_000);
  return addBusinessMinutes(startedAt, policy.minutes, calendar);
}

type SlaState = {
  dueAt: Date;
  overdue: boolean;
  /** Minutes past the deadline (0 when on time). */
  overdueMinutes: number;
  /** Minutes until the deadline (0 when overdue). */
  remainingMinutes: number;
};

export function slaState(dueAt: Date, now: Date): SlaState {
  const diff = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  return {
    dueAt,
    overdue: diff < 0,
    overdueMinutes: diff < 0 ? -diff : 0,
    remainingMinutes: diff > 0 ? diff : 0,
  };
}

export function isWithinBusinessHours(date: Date, calendar: BusinessCalendar): boolean {
  const local = new TZDate(date.getTime(), calendar.timeZone);
  if (!isBusinessDay(local, calendar)) return false;
  const hour = local.getHours() + local.getMinutes() / 60;
  return hour >= calendar.dayStartHour && hour < calendar.dayEndHour;
}

export function parseHolidays(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const days = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  return new Set(days);
}
