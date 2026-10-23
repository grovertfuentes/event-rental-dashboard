# Goodshuffle ingestion — isolated first phase

Python 3.11+ (macOS/Linux), standard library only. This directory has no frontend imports, server route, scheduled GitHub workflow or deployment configuration. It never writes Google Sheets or updates the live app. Do not put customer exports, normalized customer records, sessions or credentials in this public repository.

## Verified source recipe

Projects → Views → **All for 2026 (No Lost)** → select all → Bulk Download → **Project List XLSX** only → English → Email Files. Verified October 23, 2026: Logistics starts January 1–December 31, 2026, archived included; New, Quote Sent, Action Needed and Signed included, Lost excluded. No office, team, billing, logistics, signature, fulfillment or origin restriction. Verify these filters every run; don't edit or resave the user's view. New-year coverage requires an explicit recipe update, not an automatic switch.

The `Projects` worksheet contains a title in row 1, New York export timestamp in row 2 and headers in row 3. A real sample contained 38 columns and 1,599 unique project IDs. UI `Action Needed` exported as `Unsigned Changes`; preserve both its last approved contract and latest quote totals separately.

## Run offline

```sh
python3 -m unittest discover -s ingestion -v
python3 ingestion/projects.py /private/inbox/export.xlsx --state /private/terg-state --expected-count 1599 --baseline
python3 ingestion/projects.py /private/inbox/fresh.xlsx --state /private/terg-state --expected-count 1599 --request-after 2026-10-24T00:00:00-04:00
```

Replace the expected count and request time with the values observed for that request. `--baseline` is allowed only for the initial snapshot, never a nightly workaround. No packages or credentials are required. CSV is supported for locally converted files retaining the same two metadata rows and header row; do not rename XLSX files to CSV.

Raw bytes, SHA-256, request/export/capture times, schema, counts, normalized records and per-run status are stored under the private state directory. Permissions default to owner-only. Original source cell values are retained locally for traceability; money becomes integer cents, dates become ISO dates, and blank amounts remain null. Source times, including TBD, remain unchanged. The current pointer advances atomically only after validation. Earlier snapshots remain immutable. The importer holds a nonblocking exclusive lock.

Validation rejects formulas, unsafe/oversized XML archives, unexpected status, duplicate IDs, impossible dates, invalid amounts, wrong logistics year, missing required headers, selected-count mismatch, stale/future export timestamps, nonadvancing timestamps, a changed column set or a count drop greater than 20%. Reordered headers are accepted. Duplicate latest content does not advance the pointer. Failure manifests contain diagnostic categories, not customer values. Invalid imports retain their raw input under a quarantined run; inspect locally, never attach to alert emails.

## Nightly collection contract

The desktop scheduler wakes the existing chat at midnight in America/New_York. Browser automation and mailbox retrieval are performed by the scheduled agent following the operator's private runbook; this Python program validates files after collection. The scheduler needs the computer on, Codex running, authorized browser/mail access and a working signed-in session. This is a local pilot, not an always-on hosted collector. MFA or unavailable permissions require human attention. No passwords or browser-session exports are stored by this code.

At collection time record request time and selected count, correlate the delivered email and native file, and invoke the importer. On failure retain the previous pointer, notify the owner with a redacted stage/reason and ask for reauthentication when appropriate. After success record completion privately and remain quiet unless recovering from a prior failure. A later watchdog run checks freshness independently of the collector turn; both still depend on this local machine and scheduler being available.

## Limits and rollback

This recipe excludes lost projects and projects with logistics starting outside 2026. It cannot produce full-funnel conversion, complete signature-event history or accounting revenue. Snapshots record observed state, not every intervening edit. The importer validates file structure and coverage; the collector must verify the correct company and view because this workbook does not establish tenant identity by itself.

No automatic deletion/retention is enabled during the pilot; agree retention before long-term storage. Snapshot history is local and has no independent backup yet. Email alert delivery depends on the agent's available mailbox connection; a chat notice is the fallback. Unattended execution and alert delivery must be reviewed after the first scheduled run. Stop collection by pausing its app schedule; the live dashboard needs no rollback because it is untouched.
