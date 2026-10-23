import { EMAIL_TIME_ZONE, localDay } from "./emailCounts.js";

export const PHONE_KEYS = ["incomingCalls", "answeredCalls", "missedCalls", "voicemails"];
const shift = (day, n) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

export function validateCommunications(feed) {
  if (feed?.version !== 1 || feed.timeZone !== EMAIL_TIME_ZONE || !Array.isArray(feed.days) || !Number.isFinite(Date.parse(feed.asOf)) || !feed.phoneScope) throw new Error("Invalid communications feed");
  const seen = new Set();
  for (const row of feed.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(Date.parse(`${row.date}T12:00:00Z`)) || shift(row.date, 0) !== row.date || seen.has(row.date) || row.date > localDay(new Date(feed.asOf))) throw new Error("Invalid communications date");
    seen.add(row.date);
    for (const key of ["directEmails", ...PHONE_KEYS]) if (!Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error("Invalid communications count");
    if (row.answeredCalls + row.missedCalls !== row.incomingCalls) throw new Error("Call totals do not reconcile");
  }
  return feed;
}

export async function fetchCommunications() {
  try {
    const response = await fetch("/data/communications.json", { cache: "no-store" });
    if (!response.ok) return null;
    return validateCommunications(await response.json());
  } catch { return null; }
}

export function applyCommunications(base, feed, now = new Date()) {
  const today = localDay(now);
  const monday = shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const rows = new Map((feed?.days ?? []).map(row => [row.date, row]));
  const total = values => values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0);
  const leadDay = (row, date) => {
    const directEmails = date <= today ? rows.get(date)?.directEmails ?? null : null;
    return { ...row, directEmails, inquiries: total([row.wishlists, row.forms, directEmails]), inquiryPartial: row.emailPartial || directEmails == null };
  };
  const dates = start => Array.from({ length: 7 }, (_, i) => shift(start, i)).filter(date => date <= today);
  const leadWeek = (row, start) => {
    const directEmails = total(dates(start).map(date => rows.get(date)?.directEmails ?? null));
    return { ...row, directEmails, inquiries: total([row.wishlists, row.forms, directEmails]), inquiryPartial: row.emailPartial || directEmails == null };
  };
  const phonePeriod = dates => Object.fromEntries(PHONE_KEYS.map(key => [key, total(dates.map(date => rows.get(date)?.[key] ?? null))]));
  return {
    ...base,
    todayData: leadDay(base.todayData, today),
    yesterdayData: leadDay(base.yesterdayData, shift(today, -1)),
    weekData: base.weekData.map((row, i) => leadDay(row, shift(monday, i))),
    weekTotals: leadWeek(base.weekTotals, monday),
    lastWeekTotals: leadWeek(base.lastWeekTotals, shift(monday, -7)),
    phone: { today: phonePeriod([today]), thisWeek: phonePeriod(dates(monday)), lastWeek: phonePeriod(dates(shift(monday, -7))) },
  };
}
