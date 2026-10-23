# Email lead counts

Only aggregate counts belong in `public/data/email-counts.json`. Never commit email bodies, addresses, customer names, message IDs, browser sessions, or authentication data.

Version 1 uses `America/New_York` calendar dates. Each unique date has nonnegative integer `wishlists` and `forms`, `status` (`partial` or `complete`), and an ISO timestamp with offset in `asOf`. A partial scan establishes a minimum and displays a plus sign. Missing dates or unavailable feeds display an em dash. Weekly totals remain minimums until every elapsed day is complete; comparisons are suppressed for incomplete data.

The Oct 23 test snapshot contains one verified Goodshuffle wishlist and three distinct verified form notifications. It is partial, not a complete mailbox total. Earlier dates have not been backfilled.

Count original notification received timestamps, not latest thread reply timestamps or the form's event-date field. Deduplicate by original immutable message/event ID across shared and personal copies. Wishlist notifications originate from Goodshuffle with `New Wishlist Submission` subjects. Form notifications have `New Form Submitted` subjects. Validate templates against the private collection runbook. Replies and contract notices do not count.

At 00:30 New York time, the existing local collection automation scans the previous completed day and reconciles seven preceding days. Keep evidence and a minimal deduplication ledger privately. Publish only verified aggregate rows after full enumeration and stable deduplication. Incomplete scans must retain the previous published snapshot and alert the user; never overwrite complete rows with partial totals or substitute zeros. Authenticate interactively when required. No outbound email or inbox changes are needed.

Run `node --test src/emailCounts.test.js` and the production build before releasing changes. The Refresh button reloads the aggregate feed independently of Goodshuffle. The existing WPForms event-date feed is no longer used for Forms Received, avoiding double counting and incorrect reporting dates.
