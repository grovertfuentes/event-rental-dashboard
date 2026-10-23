export const SALES_DATE_FIELD = "First Signed Date";
export const SALES_SHEETS = [{ gid: 0, name: "2026 to date" }, { gid: 615174390, name: "2025" }, { gid: 127184042, name: "2024" }, { gid: 898947320, name: "2023" }];

export function parseProjectCsv(text) {
  const table = []; let record = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { record.push(value); value = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(value); table.push(record); record = []; value = "";
    } else value += ch;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (value || record.length) { record.push(value); table.push(record); }
  const index = table.findIndex(row => row.some(cell => /Project ID$/.test(cell.trim())) && row.some(cell => cell.trim() === "Status") && row.some(cell => cell.trim() === "Billing Status"));
  if (index < 0) throw new Error("Project CSV headers missing");
  const headers = table[index].map(h => /Project ID$/.test(h.trim()) ? "Project ID" : h.replace(/^\uFEFF/, "").trim());
  for (const key of ["First Signed Date", "Contract Total"]) if (!headers.includes(key)) throw new Error(`Missing ${key}`);
  return table.slice(index + 1).filter(row => row.some(cell => cell.trim())).map(row => Object.fromEntries(headers.map((h, i) => [h, (row[i] || "").trim()])));
}

export function deduplicateProjects(sources) {
  const seen = new Set(); const rows = [];
  for (const source of sources) for (const row of source) {
    const id = row["Project ID"]?.trim();
    if (!id) throw new Error("Missing project ID");
    if (!seen.has(id)) { seen.add(id); rows.push(row); }
  }
  return rows; // Sources are ordered newest first, so current rows take precedence.
}

export function signedDay(row) {
  const value = String(row[SALES_DATE_FIELD] || "").trim();
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const day = m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return null;
  return new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}

export const isPaidContract = row => row.Status?.trim() === "Contract Signed" && row["Billing Status"]?.trim() === "Paid";
export function contractCents(row) {
  const text = String(row["Contract Total"] ?? "").replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("Paid contract has invalid Contract Total");
  const negative = text.startsWith("-"); const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Contract value is too large");
  return negative ? -cents : cents;
}

export function paidSalesMetrics(rows, today) {
  const year = Number(today.slice(0, 4));
  const paid = rows.filter(isPaidContract);
  for (const row of paid) if (!signedDay(row)) throw new Error("Paid contract has no valid First Signed Date");
  const eligible = paid.filter(row => signedDay(row) <= today);
  const yearRows = eligible.filter(row => signedDay(row).startsWith(String(year)));
  const buckets = new Map();
  for (let y = 2023; y <= year; y++) for (let m = 1; m <= (y === year ? Number(today.slice(5, 7)) : 12); m++) buckets.set(`${y}-${String(m).padStart(2, "0")}`, { cents: 0, count: 0 });
  for (const row of eligible) { const bucket = buckets.get(signedDay(row).slice(0, 7)); if (bucket) { bucket.cents += contractCents(row); bucket.count++; } }
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return {
    rows: yearRows,
    eligibleRows: eligible,
    total: yearRows.reduce((sum, row) => sum + contractCents(row), 0) / 100,
    count: yearRows.length,
    monthly: [...buckets].map(([key, b]) => ({ m: `${names[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`, revenue: b.cents / 100, count: b.count, aov: b.count ? b.cents / 100 / b.count : 0 })),
  };
}
