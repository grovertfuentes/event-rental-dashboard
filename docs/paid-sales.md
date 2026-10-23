# Paid sales definition

Sales = Contract Total for projects whose Status is Contract Signed, Billing Status is exactly Paid, and First Signed Date belongs to the reporting period. The user explicitly selected First Signed Date to retain the original booking month. Creation date, Last Signed Date, payment date, and event date do not determine the sales month. Due, Pending, blank, and Overpaid billing statuses are excluded. There is no fallback to Quote Total or Date Created for this metric.

Paid is evaluated as of the latest export. A project becoming Paid later appears in its original signing month; this is not cash received during that month. Monthly history may therefore change as payment status changes. These figures are contract value, not accounting revenue recognition or bank deposits.

Both Overview year cards and Sales totals use the same `paidSalesMetrics` model. Daily/weekly sales, monthly charts, client spend, and paid-contract AOV share it. Contracts Signed activity counts still represent all originally signed contracts, including unpaid ones. Pipeline conversion remains a project-status measure; its signed-sales dollar display and paid count use the paid model.

Source: Master GSP Data for Dashboard Report, Google Sheet 1FBUAn82wrX2fIjgRwWDqk1C8VES6dV_yhhuVQ9TihDI. Fetch the 2026 to date tab plus the existing 2025/2024/2023 tabs; deduplicate by Project ID with the current tab taking precedence. Archived tabs retain their own export freshness (May 2026 in the baseline), so historical paid status is only as fresh as those snapshots. The former saved monthly constants are no longer used by year cards or monthly sales charts.

Values are accumulated in integer cents and rounded only for display. CSV parsing supports quoted multiline fields and export preambles. Missing dates/amounts, source fetch failures, malformed headers and missing project IDs fail closed; sales remain unavailable rather than falling back to old hardcoded totals.

Baseline reconciliation from the October 23 current export: 693 paid contracts first signed in 2026, Contract Total $721,018.47. No additional 2026 qualifying projects occur in the archived tabs. Both tabs should display $721,018. Source fields and rules are visible on the dashboard.

Run `node --test src/paidSales.test.js src/emailCounts.test.js src/communications.test.js`. Validate original signing month vs resigning date, exact Paid filtering, pre-2026 creation dates, future date exclusion, cent accuracy, duplicate precedence, missing source fields and multiline CSVs. Verify both rendered totals against the same source before release completion.
