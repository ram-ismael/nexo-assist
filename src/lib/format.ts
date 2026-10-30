/**
 * Display helpers. Every date is shown in the service-desk time zone (passed
 * down from server config), never the browser's, so employee, analyst and the
 * SLA engine all talk about the same clock.
 */
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Parts = { year: number; month: number; day: number; hour: string; minute: string };

function parts(iso: string, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map = Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour ?? "00",
    minute: map.minute ?? "00",
  };
}

export function formatTime(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function formatDay(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${String(p.day).padStart(2, "0")} ${MONTHS[p.month - 1]}`;
}

export function formatDateTime(iso: string, timeZone: string): string {
  return `${formatDay(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

function dayKey(iso: string, timeZone: string): string {
  const p = parts(iso, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isSameDay(a: string, b: string, timeZone: string): boolean {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}

export function dayLabel(iso: string, timeZone: string, now = new Date()): string {
  const today = now.toISOString();
  if (isSameDay(iso, today, timeZone)) return "Hoje";
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
  if (isSameDay(iso, yesterday, timeZone)) return "Ontem";
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
  if (isSameDay(iso, tomorrow, timeZone)) return "Amanhã";
  return formatDay(iso, timeZone);
}

/** "agora", "10:05" (today), "ontem", "16 out". Used in lists. */
export function formatListTime(iso: string, timeZone: string, now = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  if (diffMs < 60_000) return "agora";
  const label = dayLabel(iso, timeZone, now);
  if (label === "Hoje") return formatTime(iso, timeZone);
  if (label === "Ontem") return "ontem";
  return label;
}

export function relativeAge(iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export function untilLabel(iso: string, timeZone: string, now = new Date()): string {
  const label = dayLabel(iso, timeZone, now);
  const time = formatTime(iso, timeZone);
  if (label === "Hoje") return time;
  // Used mid-sentence ("resposta até amanhã, 12:00"): relative words in lowercase.
  return `${label === "Ontem" || label === "Amanhã" ? label.toLowerCase() : label}, ${time}`;
}

/** "25 min", "4 h", "1 dia", "3 dias": short elapsed or remaining time. */
export function durationLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 dia" : `${days} dias`;
}

/**
 * Countdown to a first-contact deadline, as the analyst reads it in the queue:
 * "contato em 25 min", "contato em 3 h", "contato até seg., 14:00" beyond a
 * day, and "contato atrasado há 10 min" (or "há 2 dias") once it has passed.
 */
export function contactLabel(iso: string, timeZone: string, now = new Date()): string {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes < 0) return `contato atrasado há ${durationLabel(minutes * 60_000)}`;
  if (minutes < 1) return "contato agora";
  if (minutes < 60) return `contato em ${minutes} min`;
  if (minutes < 24 * 60) return `contato em ${Math.round(minutes / 60)} h`;
  return `contato até ${untilLabel(iso, timeZone, now)}`;
}

/** WhatsApp-style "visto por último hoje às 10:42" / "ontem às 18:20" / "28 out às 09:10". */
export function lastSeenLabel(iso: string, timeZone: string, now = new Date()): string {
  const label = dayLabel(iso, timeZone, now);
  const time = formatTime(iso, timeZone);
  const day = label === "Hoje" || label === "Ontem" ? label.toLowerCase() : label;
  return `visto por último ${day} às ${time}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    (words[0]?.[0] ?? "") + (words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}
