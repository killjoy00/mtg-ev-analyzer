"""Assemble a blinded reviewer packet from verified development artifacts.

The input pairs are downloaded GitHub artifact ZIPs: development report and
separate review packet. Never include reports, coefficients, source IDs,
strata, cohort or score keys in the output. A partial packet is explicitly
marked incomplete; only all five sets with all quotas count as a full frame.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

SETS = ('dft', 'tdm', 'ktk', 'hob', 'powered-cube')
FIELDS = {'case_id', 'set', 'pick', 'prior_pool', 'pack', 'focal_card'}
STRATA = ('synergy_screen', 'splash_fixing', 'established_lane', 'early_speculation', 'close_alternative')
REVIEW_FIELDS = ('case_id', 'set', 'pick', 'prior_pool', 'pack', 'focal_card', 'quality_band', 'confidence', 'reason', 'category_confirmed', 'abstain')
RULE_FIELDS = ('name', 'type_line', 'mana_cost', 'oracle_text', 'layout', 'power', 'toughness', 'loyalty', 'card_faces')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate_pair(dev_path, blind_path):
    with ZipFile(dev_path) as z:
        report = json.loads(z.read('development.json'))
        metadata_bytes = z.read('metadata/rules.json.gz')
    with ZipFile(blind_path) as z:
        sample = z.read('blind-cases.json')
    sid = report['set']
    sampling = report['review_sampling']
    cases = json.loads(sample)
    if sid not in SETS or report['status'] != 'development_only' or report['final_assessment'] != 'locked' or report['independent_quality'] != 'not_evaluated':
        raise ValueError('unexpected development scope')
    if report['synergy_active'] or not sampling['source_distinct_within_set']:
        raise ValueError('unexpected synergy or reused sources')
    if sha(metadata_bytes) != report['sources']['metadata']['sha256'] or sha(sample) != sampling['sample_sha256']:
        raise ValueError('metadata or blind sample hash mismatch')
    expected = {c + '_' + s: 10 for c in ('validation', 'ordinary_validation') for s in STRATA}
    if sampling['stratum_counts'] != expected or len(cases) != 100 or sampling['cases'] != 100:
        raise ValueError('incomplete per-format sample quotas')
    for i, case in enumerate(cases, 1):
        if set(case) != FIELDS or case['set'] != sid or case['case_id'] != f'{sid.upper()}-{i:03d}':
            raise ValueError('blind packet contains unexpected fields or case identity')
        if not isinstance(case['prior_pool'], list) or not isinstance(case['pack'], list) or not all(isinstance(n, str) and n for n in case['prior_pool'] + case['pack']):
            raise ValueError('invalid card context')
        if case['focal_card'] not in case['pack'] or case['pick'] != f'P1P{len(case["prior_pool"]) + 1}' or not 2 <= len(case['pack']):
            raise ValueError('invalid focal card or prior pool')
    metadata = json.loads(gzip.decompress(metadata_bytes))
    rules = {}
    for name in sorted({n for case in cases for n in case['prior_pool'] + case['pack']}):
        record = metadata.get(name)
        if not isinstance(record, dict):
            rules[name] = {'name': name, 'rules_unavailable': True}
            continue
        item = {k: record[k] for k in RULE_FIELDS if k in record and k != 'card_faces'}
        if isinstance(record.get('card_faces'), list):
            item['card_faces'] = [{k: f[k] for k in RULE_FIELDS if k in f and k != 'card_faces'} for f in record['card_faces'] if isinstance(f, dict)]
        rules[name] = item
    return sid, sample, cases, rules, report


def assemble(pairs, output, allow_partial=False):
    results = [validate_pair(*pair) for pair in pairs]
    formats = {r[0] for r in results}
    if len(formats) != len(results) or not formats or (formats != set(SETS) and not allow_partial):
        raise ValueError('require five distinct formats; partial output is explicit only')
    complete = formats == set(SETS)
    cases = sorted([c for _, _, cs, _, _ in results for c in cs], key=lambda c: sha(('review-order-v1|' + c['case_id']).encode()))
    if len({c['case_id'] for c in cases}) != len(cases):
        raise ValueError('duplicate cases')
    buf = io.StringIO(newline='')
    writer = csv.DictWriter(buf, fieldnames=REVIEW_FIELDS)
    writer.writeheader()
    for c in cases:
        writer.writerow(dict(c, prior_pool=' | '.join(c['prior_pool']), pack=' | '.join(c['pack'])))
    index = {'scope': 'unlabeled blinded historical review frame', 'complete_frame': complete, 'case_count': len(cases),
             'sample_sha256_by_set': {sid: sha(b) for sid, b, _, _, _ in results},
             'rules_metadata_sha256_by_set': {sid: r['sources']['metadata']['sha256'] for sid, _, _, _, r in results},
             'missing_sets': sorted(set(SETS) - formats), 'independent_ratings_present': False}
    readme = f'''# Pack One blinded draft review

{'Complete initial sampling frame' if complete else 'PARTIAL frame (do not use to claim full benchmark coverage)'}: {len(cases)} cases.

Each reviewer should independently fill a separate copy of review.csv. Judge the focal card relative to the actual pack and previously drafted pool, using only information available at that pick. Multiple cards can be excellent. Use the card reference in rules-by-set.json when needed; missing rules are explicitly marked. If a card is unfamiliar or context is insufficient, abstain and explain why. Do not inspect model results, look up the original historical selection, consult the other reviewer, or infer a score from this sampling frame.

Quality bands: excellent / good / defensible / questionable / poor. These are qualitative judgments, not numeric score predictions. Provide confidence (high/medium/low), a short reason, and abstain=yes if appropriate. category_confirmed may be left blank. Keep completed review copies private until locked and independently adjudicated.

The individual original blind samples are included byte-for-byte for reproducibility; they contain the same cases as the combined CSV. The initial frame targets 100 distinct draft decisions per format; screening categories still require adjudication and may need supplementary cases. No model predictions, choices, outcome data, reviewer answers or score keys are included.

Draft context: 17Lands public datasets (CC BY 4.0), https://www.17lands.com/public_datasets . Rules metadata from pinned Scryfall API records, https://scryfall.com/docs/api . No Pack One player data.
'''
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w', ZIP_DEFLATED) as z:
        z.writestr('README.md', readme)
        z.writestr('review.csv', buf.getvalue().encode('utf-8-sig'))
        z.writestr('packet-index.json', json.dumps(index, indent=2) + '\n')
        z.writestr('rules-by-set.json', json.dumps({r[0]: r[3] for r in results}, ensure_ascii=False, indent=2) + '\n')
        for sid, sample, _, _, _ in results:
            z.writestr(f'original-samples/{sid}.json', sample)
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', nargs=2, type=Path, action='append', required=True, metavar=('DEVELOPMENT_ZIP', 'BLIND_ZIP'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--allow-partial', action='store_true')
    args = parser.parse_args()
    print(json.dumps(assemble(args.pair, args.output, args.allow_partial), indent=2))


if __name__ == '__main__':
    main()
