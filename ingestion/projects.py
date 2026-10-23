"""Private, offline Goodshuffle Project List ingestion. Python 3.11+, stdlib only."""
import argparse
import collections
import csv
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import uuid
import xml.etree.ElementTree as ET
import zipfile
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REQUIRED = {'Project ID', 'Status', 'Client Name', 'Date Created', 'Last Quote Sent',
            'Last Signed Date', 'Contract Total', 'Quote Total', 'Logistics Start Date',
            'First Signed Date', 'Net Paid', 'Amount Due'}
MONEY = {'Quote Total': 'quote_total_cents', 'Contract Total': 'contract_total_cents',
         'Contract Tax': 'contract_tax_cents', 'Net Paid': 'net_paid_cents',
         'Amount Due': 'amount_due_cents'}
DATES = {'Date Created': 'created_on', 'First Signed Date': 'first_signed_on',
         'Last Signed Date': 'last_signed_on', 'Last Quote Sent': 'last_quote_sent_on',
         'Logistics Start Date': 'logistics_start_on', 'Event Start Date': 'event_start_on',
         'Event End Date': 'event_end_on'}
STATUSES = {'New Project': 'new', 'Quote Sent': 'quote_sent',
            'Contract Signed': 'signed', 'Unsigned Changes': 'unsigned_changes'}
VERSION = 1


class InvalidExport(ValueError):
    pass


def xml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise InvalidExport('XML declarations are not allowed')
    return ET.fromstring(data)


def xlsx_rows(blob):
    """Read the named Projects worksheet, including shared/inline strings; no formulas."""
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        infos = archive.infolist()
        if len(infos) > 1000 or sum(i.file_size for i in infos) > 50_000_000:
            raise InvalidExport('Workbook exceeds expansion limits')
        if any(PurePosixPath(i.filename).is_absolute() or '..' in PurePosixPath(i.filename).parts
               for i in infos):
            raise InvalidExport('Unsafe archive path')
        workbook = xml(archive.read('xl/workbook.xml'))
        sheets = [s for s in workbook.findall('s:sheets/s:sheet', NS)
                  if s.attrib.get('name') == 'Projects']
        if len(sheets) != 1:
            raise InvalidExport('Expected one Projects worksheet')
        relationship = sheets[0].attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
        rels = xml(archive.read('xl/_rels/workbook.xml.rels'))
        matches = [r for r in rels if r.attrib.get('Id') == relationship]
        if len(matches) != 1 or matches[0].attrib.get('TargetMode') == 'External':
            raise InvalidExport('Invalid worksheet relationship')
        target = matches[0].attrib['Target']
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        if '..' in PurePosixPath(sheet_path).parts:
            raise InvalidExport('Unsafe worksheet path')
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            for item in xml(archive.read('xl/sharedStrings.xml')).findall('s:si', NS):
                strings.append(''.join(t.text or '' for t in item.iterfind('.//s:t', NS)))
        rows = []
        for row in xml(archive.read(sheet_path)).findall('s:sheetData/s:row', NS):
            values = []
            for cell in row.findall('s:c', NS):
                if cell.find('s:f', NS) is not None:
                    raise InvalidExport('Formulas are not accepted in source exports')
                ref = re.fullmatch(r'([A-Z]+)[1-9][0-9]*', cell.attrib.get('r', ''))
                if not ref:
                    raise InvalidExport('Invalid cell coordinate')
                col = 0
                for letter in ref[1]:
                    col = col * 26 + ord(letter) - 64
                if col > 256:
                    raise InvalidExport('Too many columns')
                while len(values) < col:
                    values.append('')
                value = cell.findtext('s:v', default='', namespaces=NS)
                kind = cell.attrib.get('t')
                if kind == 's':
                    value = strings[int(value)]
                elif kind == 'inlineStr':
                    value = ''.join(t.text or '' for t in cell.iterfind('.//s:t', NS))
                elif kind in {'e', 'b'}:
                    raise InvalidExport('Unexpected error/boolean source value')
                values[col - 1] = value
            rows.append(values)
        return rows


def money(value):
    value = str(value).strip()
    if not value:
        return None
    if value.startswith('(') and value.endswith(')'):
        value = '-' + value[1:-1]
    value = value.replace('$', '').replace(',', '')
    try:
        amount = Decimal(value)
        cents = amount * 100
        if not amount.is_finite() or cents != cents.to_integral_value():
            raise InvalidOperation
        return int(cents)
    except InvalidOperation:
        raise InvalidExport('Invalid monetary value') from None


def date(value):
    if not value:
        return None
    if not re.fullmatch(r'\d{1,2}/\d{1,2}/\d{4}', str(value)):
        raise InvalidExport('Expected US calendar date')
    try:
        return datetime.strptime(str(value), '%m/%d/%Y').date().isoformat()
    except ValueError:
        raise InvalidExport('Impossible calendar date') from None


def export_time(value):
    match = re.fullmatch(r'(\d{1,2}/\d{1,2}/\d{4}) @ (\d{1,2}:\d{2} [AP]M) (EDT|EST)', value)
    if not match:
        raise InvalidExport('Unrecognized export timestamp')
    try:
        dt = datetime.strptime(match[1] + ' ' + match[2], '%m/%d/%Y %I:%M %p').replace(tzinfo=NY)
    except ValueError:
        raise InvalidExport('Invalid export timestamp') from None
    if dt.tzname() != match[3]:
        raise InvalidExport('Export timezone does not match New York date')
    return dt


def normalize(blob, suffix, year):
    if len(blob) > 10_000_000:
        raise InvalidExport('Source exceeds 10 MB limit')
    if suffix == '.xlsx':
        rows = xlsx_rows(blob)
    elif suffix == '.csv':
        rows = list(csv.reader(io.StringIO(blob.decode('utf-8-sig'), newline=''), strict=True))
    else:
        raise InvalidExport('Only native XLSX or UTF-8 CSV accepted')
    if len(rows) < 4 or not rows[0] or rows[0][0] != 'Goodshuffle Pro Project List Export':
        raise InvalidExport('Expected Goodshuffle title and nonempty export')
    exported = export_time(rows[1][0])
    headers = [str(h).strip() for h in rows[2]]
    if len(headers) != len(set(headers)) or any(not h for h in headers):
        raise InvalidExport('Blank or duplicate header')
    if not REQUIRED <= set(headers):
        raise InvalidExport('Missing required headers: ' + ', '.join(sorted(REQUIRED - set(headers))))
    projects, ids = [], set()
    for row in rows[3:]:
        if not any(row):
            continue
        if len(row) > len(headers):
            raise InvalidExport('Unexpected row width')
        source = dict(zip(headers, row + [''] * (len(headers) - len(row))))
        pid = str(source['Project ID']).strip()
        if not re.fullmatch(r'[0-9]+', pid) or pid in ids:
            raise InvalidExport('Missing, invalid or duplicate Project ID')
        ids.add(pid)
        if source['Status'] not in STATUSES:
            raise InvalidExport('Unexpected status for No Lost view')
        project = {'project_id': pid, 'status': STATUSES[source['Status']], 'source': source}
        for header, field in MONEY.items():
            project[field] = money(source.get(header, ''))
        for header, field in DATES.items():
            project[field] = date(source.get(header, ''))
        if not project['created_on'] or not project['logistics_start_on']:
            raise InvalidExport('Missing required project date')
        if not project['logistics_start_on'].startswith(str(year) + '-'):
            raise InvalidExport('Logistics date outside saved-view year')
        # Keep source times intact, including TBD; never invent a time or replace a blank amount.
        projects.append(project)
    if not projects:
        raise InvalidExport('Empty snapshot requires investigation')
    return exported, headers, projects


def write_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def ingest(source, state, expected_count, request_after=None, baseline=False, year=2026, now=None):
    now = now or datetime.now(timezone.utc)
    if not baseline and request_after is None:
        raise InvalidExport('Nightly runs require request-after')
    if now.tzinfo is None or (request_after and request_after.tzinfo is None):
        raise InvalidExport('Times must include a UTC offset')
    if expected_count <= 0:
        raise InvalidExport('Expected count must be positive')
    os.umask(0o077)
    state = Path(state)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    with (state / '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise InvalidExport('Another import is running') from None
        run_id = now.strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:12]
        run = state / 'runs' / run_id
        run.mkdir(parents=True, mode=0o700)
        manifest = {'version': VERSION, 'run_id': run_id, 'status': 'quarantined',
                    'report': 'projects_2026_no_lost', 'captured_at': now.isoformat(),
                    'business_date': (now.astimezone(NY).date() - timedelta(days=1)).isoformat(),
                    'baseline': baseline, 'expected_count': expected_count,
                    'request_after': request_after.isoformat() if request_after else None}
        try:
            source = Path(source)
            if source.stat().st_size > 10_000_000:
                raise InvalidExport('Source exceeds 10 MB limit')
            blob = source.read_bytes()
            digest = hashlib.sha256(blob).hexdigest()
            manifest['sha256'] = digest
            suffix = source.suffix.lower()
            (run / ('original' + suffix if suffix in {'.xlsx', '.csv'} else 'original.bin')).write_bytes(blob)
            exported, headers, projects = normalize(blob, suffix, year)
            manifest.update(exported_at=exported.isoformat(), row_count=len(projects), headers=headers,
                            status_counts=dict(collections.Counter(p['status'] for p in projects)))
            if len(projects) != expected_count:
                raise InvalidExport('Export count differs from selected project count')
            if exported > now + timedelta(minutes=5):
                raise InvalidExport('Future export timestamp')
            if not baseline and (exported < now - timedelta(minutes=45) or
                                 exported < request_after - timedelta(minutes=1)):
                raise InvalidExport('Export is stale or predates this request')
            latest_path = state / 'latest.json'
            previous = json.loads(latest_path.read_text()) if latest_path.exists() else None
            if baseline and previous:
                raise InvalidExport('Baseline allowed only before the first accepted snapshot')
            if previous:
                if previous['sha256'] == digest:
                    manifest.update(status='duplicate', duplicate_of=previous['run_id'])
                    write_json(run / 'manifest.json', manifest)
                    return manifest
                if exported <= datetime.fromisoformat(previous['exported_at']):
                    raise InvalidExport('Export does not advance previous source timestamp')
                if len(projects) < previous['row_count'] * Decimal('0.8'):
                    raise InvalidExport('Row count dropped by more than 20 percent')
                old_headers = set(previous['headers'])
                if set(headers) != old_headers:
                    raise InvalidExport('Source column set changed; schema review required')
            write_json(run / 'projects.json', projects)
            manifest['status'] = 'validated'
            write_json(run / 'manifest.json', manifest)
            # Only this private pointer changes; the frontend never reads this directory.
            write_json(latest_path, manifest)
            return manifest
        except Exception as exc:
            # Do not log customer cell contents or unexpected library exception messages.
            manifest['error'] = str(exc) if isinstance(exc, InvalidExport) else type(exc).__name__
            write_json(run / 'manifest.json', manifest)
            raise InvalidExport(manifest['error']) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, required=True)
    parser.add_argument('--request-after', type=datetime.fromisoformat)
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    try:
        result = ingest(args.source, args.state, args.expected_count, args.request_after, args.baseline)
        print(json.dumps({k: result[k] for k in ('run_id', 'status', 'row_count', 'sha256')}))
    except (InvalidExport, OSError) as exc:
        print(json.dumps({'status': 'failed', 'error': str(exc) if isinstance(exc, InvalidExport) else type(exc).__name__}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
