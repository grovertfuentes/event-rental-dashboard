import test from "node:test";
import assert from "node:assert/strict";
import { localDay, validateEmailCounts, applyEmailCounts, displayEmailCount } from "./emailCounts.js";

const row = { date: "2026-10-23", wishlists: 1, forms: 3, status: "partial", asOf: "2026-10-23T19:41:56Z" };
const feed = days => ({ version: 1, timeZone: "America/New_York", days });
const base = { todayData: { forms: 99, totalSales: 219 }, yesterdayData: { forms: 12 }, weekData: Array.from({ length: 7 }, (_, i) => ({ day: i, forms: 99, sales: 100 })), weekTotals: { forms: 99, sales: 17813 }, lastWeekTotals: { forms: 99 } };
test("New York date respects midnight and DST", () => {
  assert.equal(localDay(new Date("2026-10-24T03:59:59Z")), "2026-10-23");
  assert.equal(localDay(new Date("2026-10-24T04:00:00Z")), "2026-10-24");
  assert.equal(localDay(new Date("2026-11-02T04:59:59Z")), "2026-11-01");
  assert.equal(localDay(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
});
test("reject duplicate dates, impossible dates, negative counts and missing verification", () => {
  for (const days of [[row, row], [{ ...row, date: "2026-02-30" }], [{ ...row, forms: -1 }], [{ ...row, forms: "3" }], [{ ...row, status: "unknown" }], [{ ...row, asOf: "" }]]) assert.throws(() => validateEmailCounts(feed(days)));
});
test("replace event-date forms instead of adding; leave sales untouched", () => {
  const result = applyEmailCounts(base, validateEmailCounts(feed([row])), new Date(row.asOf));
  assert.equal(result.todayData.forms, 3);
  assert.equal(result.todayData.wishlists, 1);
  assert.equal(result.todayData.totalSales, 219);
  assert.equal(result.weekTotals.sales, 17813);
  assert.equal(result.weekTotals.forms, 3);
  assert.equal(result.weekTotals.emailPartial, true);
  assert.equal(result.yesterdayData.forms, null);
  assert.equal(result.lastWeekTotals.forms, null);
  assert.equal(result.weekData[4].forms, 3);
  assert.equal(result.weekData[5].forms, null);
  assert.equal(base.todayData.forms, 99);
});
test("unavailable feed and new days never become zero", () => {
  assert.equal(applyEmailCounts(base, null, new Date(row.asOf)).todayData.forms, null);
  assert.equal(applyEmailCounts(base, feed([row]), new Date("2026-10-24T04:00:00Z")).todayData.forms, null);
  assert.equal(displayEmailCount(null), "—");
  assert.equal(displayEmailCount(3, true), "3+");
  assert.equal(displayEmailCount(0), "0");
});
test("complete elapsed week can show exact zero", () => {
  const complete = { ...row, date: "2026-10-19", forms: 0, wishlists: 0, status: "complete" };
  const result = applyEmailCounts(base, feed([complete]), new Date("2026-10-19T20:00:00Z"));
  assert.equal(result.weekTotals.forms, 0);
  assert.equal(result.weekTotals.emailPartial, false);
});
test("fully enumerated current snapshots support weekly comparisons without inventing future activity", () => {
  const days = Array.from({ length: 12 }, (_, i) => ({ ...row, date: new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10), forms: i < 7 ? 2 : 3, wishlists: 1, status: i === 11 ? "current" : "complete" }));
  const result = applyEmailCounts(base, validateEmailCounts(feed(days)), new Date(row.asOf));
  assert.equal(result.weekTotals.forms, 15);
  assert.equal(result.lastWeekTotals.forms, 14);
  assert.equal(result.weekTotals.emailPartial, false);
  assert.equal(result.lastWeekTotals.emailPartial, false);
  assert.equal(result.todayData.forms, 3);
  assert.equal(result.weekData[5].forms, null);
  assert.throws(() => validateEmailCounts(feed([{ ...row, date: "2026-10-22", status: "current" }])));
});
