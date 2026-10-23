import test from "node:test";
import assert from "node:assert/strict";
import { paidSalesMetrics, deduplicateProjects, parseProjectCsv, signedDay } from "./paidSales.js";
const row = (id, date, billing = "Paid", amount = "$100.25") => ({ "Project ID": id, Status: "Contract Signed", "Billing Status": billing, "First Signed Date": date, "Last Signed Date": "10/23/2026", "Date Created": "01/01/2025", "Contract Total": amount });
test("sales use original signing month, exact Paid billing and contract value", () => {
  const rows = [row("1", "01/02/2026"), row("2", "10/01/2026", "Due"), row("3", "10/01/2026", "Overpaid"), row("4", "10/24/2026"), row("5", "12/31/2025"), row("6", "10/23/2026", "Paid", "$50.10")];
  const result = paidSalesMetrics(rows, "2026-10-23");
  assert.equal(result.total, 150.35); assert.equal(result.count, 2);
  assert.equal(result.eligibleRows.length, 3);
  assert.equal(result.monthly.find(m => m.m === "Jan 26").revenue, 100.25);
  assert.equal(result.monthly.find(m => m.m === "Oct 26").revenue, 50.1);
  assert.equal(Math.round(result.monthly.filter(m => m.m.endsWith("26")).reduce((sum, m) => sum + m.revenue, 0) * 100), 15035);
});
test("missing signing dates or contract values fail instead of using creation/quote data", () => {
  assert.throws(() => paidSalesMetrics([row("1", "")], "2026-10-23"));
  assert.throws(() => paidSalesMetrics([row("1", "01/01/2026", "Paid", "")], "2026-10-23"));
  assert.equal(signedDay(row("1", "02/30/2026")), null);
});
test("newest duplicate project wins even if an older snapshot was Paid", () => {
  const rows = deduplicateProjects([[row("1", "01/01/2026", "Due")], [row("1", "01/01/2026")]]);
  assert.equal(paidSalesMetrics(rows, "2026-10-23").total, 0);
});
test("CSV supports export preambles, multiline fields, commas and escaped quotes", () => {
  const csv = 'Export\nTimestamp\nProject ID,Status,Billing Status,First Signed Date,Contract Total,Inventory Alerts\r\n1,Contract Signed,Paid,01/02/2026,"$1,000.25","Two\nalerts ""here"""\r\n';
  const rows = parseProjectCsv(csv); assert.equal(rows.length, 1); assert.equal(rows[0]["Inventory Alerts"], 'Two\nalerts "here"');
  assert.equal(paidSalesMetrics(rows, "2026-10-23").total, 1000.25);
});
