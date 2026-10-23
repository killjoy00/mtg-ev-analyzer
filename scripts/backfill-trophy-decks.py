"""Download pinned public game archives and extract matched final decks.

The manifest contains set_id, event_type, url, bytes and optional etag/sha256.
Source inventories are SET_ID.json arrays of source metadata, without payloads.
All downloaded archives and normalized private build inputs stay outside git.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import gzip

spec = importlib.util.spec_from_file_location('extract_trophy_decks', Path(__file__).with_name('extract-trophy-decks.py'))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def run_archive(row, inventories, destination):
    set_id, event = row['set_id'], row['event_type']
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', set_id) or event not in ('PremierDraft', 'TradDraft'):
        raise ValueError('Invalid archive identity')
    url = urllib.parse.urlparse(row['url'])
    if url.scheme != 'https' or url.netloc != '17lands-public.s3.amazonaws.com' or not url.path.startswith('/analysis_data/game_data/'):
        raise ValueError('Expected an official public 17Lands game archive')
    source_file = inventories / (set_id + '.json')
    inventory_bytes = source_file.read_bytes()
    inventory = json.loads(inventory_bytes)
    if not extractor.wanted_sources(inventory, set_id, event):
        return None
    stem = set_id + '.' + event
    archive = destination / 'source' / (stem + '.games.csv.gz')
    report_file = destination / (stem + '.coverage.json')
    output_file = destination / (stem + '.final-decks.jsonl.gz')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists() or archive.stat().st_size != row['bytes']:
        request = urllib.request.Request(row['url'], headers={'User-Agent': 'PackOneDeckCoverage/1.0'})
        temporary = archive.with_suffix(archive.suffix + '.tmp')
        digest, count = hashlib.sha256(), 0
        with urllib.request.urlopen(request, timeout=45) as response, open(temporary, 'wb') as target:
            if row.get('etag') and response.headers.get('etag') != row['etag']:
                raise ValueError('Archive changed since the reviewed manifest')
            for block in iter(lambda: response.read(1024 * 1024), b''):
                count += len(block)
                digest.update(block)
                target.write(block)
        if count != row['bytes'] or row.get('sha256') and digest.hexdigest() != row['sha256']:
            raise ValueError('Archive bytes do not match the reviewed manifest')
        temporary.replace(archive)
    inventory_hash = hashlib.sha256(inventory_bytes).hexdigest()
    if output_file.exists() and report_file.exists():
        previous = json.loads(report_file.read_text())
        if previous.get('inventory_sha256') == inventory_hash:
            digest = hashlib.sha256()
            with open(archive, 'rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(block)
            if previous['archive_sha256'] == digest.hexdigest() and (
                    not row.get('sha256') or row['sha256'] == digest.hexdigest()):
                return previous
    decks, report = extractor.extract(archive, inventory, set_id, event, row.get('expansion'))
    if row.get('sha256') and report['archive_sha256'] != row['sha256']:
        raise ValueError('Cached archive does not match the reviewed hash')
    report.update(inventory_sha256=inventory_hash, archive_url=row['url'],
                  archive_etag=row.get('etag'), archive_updated=row.get('updated'))
    temporary = output_file.with_suffix(output_file.suffix + '.tmp')
    with gzip.open(temporary, 'wt', encoding='utf-8') as target:
        for deck in decks:
            target.write(json.dumps(deck, separators=(',', ':')) + '\n')
    temporary.replace(output_file)
    report_file.write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--inventories', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 5))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    rows = json.loads(args.manifest.read_text())
    reports, errors = [], []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(run_archive, row, args.inventories, args.output_dir): row for row in rows}
        for future in as_completed(futures):
            try:
                report = future.result()
            except Exception as error:
                row = futures[future]
                failure = {'set_id': row['set_id'], 'event_type': row['event_type'], 'error': str(error)}
                errors.append(failure)
                print(json.dumps(failure), flush=True)
                continue
            if report is None:
                continue
            reports.append(report)
            (args.output_dir / 'coverage-progress.json').write_text(json.dumps(reports, indent=2) + '\n')
            print(json.dumps({key: report[key] for key in [
                'set_id', 'event_type', 'wanted_sources', 'matched_sources', 'decks', 'seconds']}), flush=True)
    print(json.dumps({'archives': len(reports), 'source_drafts': sum(r['wanted_sources'] for r in reports),
                      'matched_sources': sum(r['matched_sources'] for r in reports),
                      'decks': sum(r['decks'] for r in reports), 'failed_archives': len(errors)}))
    if errors:
        (args.output_dir / 'coverage-errors.json').write_text(json.dumps(errors, indent=2) + '\n')
        raise SystemExit('Some archives failed; resume after resolving the reported failures.')


if __name__ == '__main__':
    main()
