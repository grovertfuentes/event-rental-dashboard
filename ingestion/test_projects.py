import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import projects
from zoneinfo import ZoneInfo

from projects import InvalidExport, REQUIRED, export_time, ingest, money, normalize


def fixture(count=2, timestamp='10/23/2026 @ 02:48 PM EDT', change=None):
    headers = sorted(REQUIRED)
    out = io.StringIO(newline='')
    writer = csv.writer(out)
    writer.writerow(['Goodshuffle Pro Project List Export'])
    writer.writerow([timestamp])
    writer.writerow(headers)
    for n in range(count):
        row = dict.fromkeys(headers, '')
        row.update({'Project ID': str(100 + n), 'Status': 'Contract Signed',
                    'Client Name': 'Example, "Client"\nSecond line',
                    'Date Created': '12/31/2025', 'Logistics Start Date': '10/25/2026',
                    'First Signed Date': '10/20/2026', 'Last Signed Date': '10/23/2026',
                    'Quote Total': '$1,000.01', 'Contract Total': '900.00',
                    'Net Paid': '100', 'Amount Due': ''})
        if change:
            change(row, n)
        writer.writerow([row[h] for h in headers])
    return out.getvalue().encode('utf-8-sig')


class IngestionTests(unittest.TestCase):
    def test_publication_failure_keeps_old_pointer_and_quarantines(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, state = root / 'source.csv', root / 'private'
            source.write_bytes(fixture())
            now = datetime(2026, 10, 23, 19, tzinfo=timezone.utc)
            ingest(source, state, 2, baseline=True, now=now)
            before = (state / 'latest.json').read_bytes()
            source.write_bytes(fixture(timestamp='10/23/2026 @ 03:00 PM EDT'))
            real_write = projects.write_json
            def fail_pointer(path, value):
                if path.name == 'latest.json':
                    raise OSError('simulated disk failure')
                real_write(path, value)
            with patch.object(projects, 'write_json', side_effect=fail_pointer):
                with self.assertRaises(InvalidExport):
                    ingest(source, state, 2, now, now=now)
            self.assertEqual((state / 'latest.json').read_bytes(), before)
            manifests = [json.loads(p.read_text()) for p in (state / 'runs').glob('*/manifest.json')]
            self.assertEqual(sorted(m['status'] for m in manifests), ['quarantined', 'validated'])

    def test_multiline_bom_money_and_old_creation_year(self):
        _, _, data = normalize(fixture(), '.csv', 2026)
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]['quote_total_cents'], 100001)
        self.assertEqual(data[0]['created_on'], '2025-12-31')
        self.assertIsNone(data[0]['amount_due_cents'])
        self.assertIn('\n', data[0]['source']['Client Name'])
        self.assertEqual(money('($1,200.32)'), -120032)
        for bad in ('NaN', 'Infinity', '1.001', 'unknown'):
            with self.assertRaises(InvalidExport):
                money(bad)

    def test_duplicate_invalid_date_status_and_scope(self):
        changes = [lambda r, n: r.update({'Project ID': '1'}),
                   lambda r, n: r.update({'Date Created': '02/30/2026'}),
                   lambda r, n: r.update({'Status': 'Lost'}),
                   lambda r, n: r.update({'Logistics Start Date': '01/01/2027'})]
        for change in changes:
            with self.assertRaises(InvalidExport):
                normalize(fixture(change=change), '.csv', 2026)

    def test_missing_and_duplicate_header(self):
        for blob in (fixture().replace(b'First Signed Date', b'Unknown Column'),
                     fixture().replace(b'First Signed Date', b'Date Created')):
            with self.assertRaises(InvalidExport):
                normalize(blob, '.csv', 2026)

    def test_new_york_midnight_and_dst(self):
        for stamp, offset in [('03/08/2026 @ 12:00 AM EST', -5),
                              ('03/09/2026 @ 12:00 AM EDT', -4),
                              ('11/01/2026 @ 12:00 AM EDT', -4),
                              ('11/02/2026 @ 12:00 AM EST', -5)]:
            self.assertEqual(export_time(stamp).utcoffset().total_seconds(), offset * 3600)
        with self.assertRaises(InvalidExport):
            export_time('07/01/2026 @ 12:00 AM EST')

    def test_failures_do_not_promote_and_raw_is_retained(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, state = root / 'source.csv', root / 'private'
            source.write_bytes(fixture())
            now = datetime(2026, 10, 23, 19, tzinfo=timezone.utc)
            accepted = ingest(source, state, 2, baseline=True, now=now)
            pointer = (state / 'latest.json').read_bytes()
            for blob, count, requested in [
                (fixture(), 2, datetime(2026, 10, 23, 19, tzinfo=timezone.utc)),
                (fixture(timestamp='10/23/2026 @ 03:00 PM EDT'), 3, now),
                (fixture(count=1, timestamp='10/23/2026 @ 03:00 PM EDT'), 1, now)]:
                source.write_bytes(blob)
                with self.assertRaises(InvalidExport):
                    ingest(source, state, count, requested, now=now)
                self.assertEqual((state / 'latest.json').read_bytes(), pointer)
            runs = list((state / 'runs').iterdir())
            self.assertEqual(len(runs), 4)
            self.assertTrue(all((r / 'original.csv').exists() for r in runs))
            self.assertEqual(accepted['status'], 'validated')
            self.assertEqual(state.stat().st_mode & 0o777, 0o700)

    def test_duplicate_is_idempotent_and_new_snapshot_promotes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, state = root / 'source.csv', root / 'private'
            source.write_bytes(fixture())
            now = datetime(2026, 10, 23, 18, 50, tzinfo=timezone.utc)
            first = ingest(source, state, 2, baseline=True, now=now)
            again = ingest(source, state, 2, datetime(2026, 10, 23, 18, 48, tzinfo=timezone.utc), now=now)
            self.assertEqual(again['status'], 'duplicate')
            self.assertEqual(json.loads((state / 'latest.json').read_text())['run_id'], first['run_id'])
            source.write_bytes(fixture(timestamp='10/24/2026 @ 12:02 AM EDT'))
            next_now = datetime(2026, 10, 24, 4, 4, tzinfo=timezone.utc)
            next_run = ingest(source, state, 2, datetime(2026, 10, 24, 4, tzinfo=timezone.utc), now=next_now)
            self.assertEqual(next_run['business_date'], '2026-10-23')
            self.assertEqual(next_run['status'], 'validated')
            with self.assertRaises(InvalidExport):
                ingest(source, state, 2, baseline=True, now=next_now)


if __name__ == '__main__':
    unittest.main()
