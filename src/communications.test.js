import test from "node:test";
import assert from "node:assert/strict";
import { validateCommunications, applyCommunications } from "./communications.js";

const now = new Date("2026-10-23T20:37:05Z");
const row = { date: "2026-10-23", directEmails: 2, incomingCalls: 20, answeredCalls: 12, missedCalls: 8, voicemails: 0 };
const feed = { version: 1, timeZone: "America/New_York", asOf: now.toISOString(), phoneScope: "Extension 1", days: [row] };
const base = { todayData: { forms: 4, wishlists: 1, totalSales: 219 }, yesterdayData: { forms: 7, wishlists: 8 }, weekData: Array.from({ length: 7 }, () => ({ forms: 4, wishlists: 1 })), weekTotals: { forms: 23, wishlists: 30, sales: 17813 }, lastWeekTotals: { forms: 22, wishlists: 36 } };
test("incoming inquiries are forms plus Wishlists plus new direct requests only", () => {
  const result = applyCommunications(base, validateCommunications(feed), now);
  assert.equal(result.todayData.inquiries, 7);
  assert.equal(result.todayData.totalSales, 219);
  assert.equal(result.phone.today.incomingCalls, 20);
  assert.equal(result.phone.today.answeredCalls, 12);
  assert.equal(result.weekData[5].inquiries, null);
});
test("missing coverage cannot silently become zero or a complete inquiry total", () => {
  const result = applyCommunications(base, null, now);
  assert.equal(result.todayData.inquiries, null);
  assert.equal(result.weekTotals.inquiries, null);
  assert.equal(result.phone.today.voicemails, null);
  assert.equal(result.todayData.inquiryPartial, true);
});
test("validate dates, unique rows and reconciled calls", () => {
  assert.throws(() => validateCommunications({ ...feed, days: [row, row] }));
  assert.throws(() => validateCommunications({ ...feed, days: [{ ...row, missedCalls: 9 }] }));
  assert.throws(() => validateCommunications({ ...feed, days: [{ ...row, directEmails: -1 }] }));
  assert.throws(() => validateCommunications({ ...feed, days: [{ ...row, date: "2026-02-30" }] }));
});
test("complete weekly coverage totals direct inquiries and calls independently", () => {
  const days = Array.from({ length: 12 }, (_, i) => ({ ...row, date: new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10), directEmails: i < 7 ? 1 : 2 }));
  const result = applyCommunications(base, validateCommunications({ ...feed, days }), now);
  assert.equal(result.weekTotals.inquiries, 63);
  assert.equal(result.lastWeekTotals.inquiries, 65);
  assert.equal(result.phone.thisWeek.incomingCalls, 100);
  assert.equal(result.phone.lastWeek.incomingCalls, 140);
});
