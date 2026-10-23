export const EMAIL_TIME_ZONE = "America/New_York";

export function localDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EMAIL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shift(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function validateEmailCounts(value) {
  if (value?.version !== 1 || value.timeZone !== EMAIL_TIME_ZONE || !Array.isArray(value.days)) throw new Error("Invalid email count feed");
  const seen = new Set();
  for (const row of value.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(Date.parse(`${row.date}T12:00:00Z`)) || shift(row.date, 0) !== row.date || seen.has(row.date)) throw new Error("Invalid or duplicate date");
    seen.add(row.date);
    if (!["complete", "partial"].includes(row.status) || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.asOf) || !Number.isFinite(Date.parse(row.asOf))) throw new Error("Invalid verification status");
    if (localDay(new Date(row.asOf)) < row.date) throw new Error("Scan precedes reporting day");
    for (const key of ["wishlists", "forms"]) if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error("Invalid email count");
  }
  return value;
}

export async function fetchEmailCounts() {
  try {
    const response = await fetch("/data/email-counts.json", { cache: "no-store" });
    if (!response.ok) return null;
    return validateEmailCounts(await response.json());
  } catch { return null; }
}

export function applyEmailCounts(base, feed, now = new Date()) {
  const today = localDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shift(today, -((weekday + 6) % 7));
  const rows = new Map((feed?.days ?? []).map(row => [row.date, row]));
  const day = date => {
    const row = date <= today ? rows.get(date) : null;
    return { wishlists: row?.wishlists ?? null, forms: row?.forms ?? null, emailPartial: row?.status !== "complete" };
  };
  const week = start => {
    const elapsed = Array.from({ length: 7 }, (_, i) => shift(start, i)).filter(date => date <= today).map(day);
    const result = { emailPartial: elapsed.some(row => row.emailPartial) };
    for (const key of ["wishlists", "forms"]) {
      const known = elapsed.map(row => row[key]).filter(value => value !== null);
      result[key] = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    return result;
  };
  return {
    ...base,
    todayData: { ...base.todayData, ...day(today) },
    yesterdayData: { ...base.yesterdayData, ...day(shift(today, -1)) },
    weekData: base.weekData.map((row, i) => ({ ...row, ...day(shift(monday, i)) })),
    weekTotals: { ...base.weekTotals, ...week(monday) },
    lastWeekTotals: { ...base.lastWeekTotals, ...week(shift(monday, -7)) },
  };
}

export const displayEmailCount = (value, partial = false) => value == null ? "—" : `${value}${partial ? "+" : ""}`;
