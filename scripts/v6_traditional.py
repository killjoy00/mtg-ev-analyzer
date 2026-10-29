"""Rescore every measured Traditional source with v6 Premier graders and admit it or not.

No Traditional observation is used for fitting and no gate threshold changes.
Each environment is scored once, on its approved window only: regular P1-P8,
Powered Cube P2-P7, FRA P1-P6. There is no fallback to another window (owner,
2026-10-29). A set that fails is not admitted. Membership is the measured source
list: the v4 Phase 2 artifacts, FRA's new-set artifact, or for HOB, whose
original Traditional archive was replaced upstream, a fresh v6 measurement of
its current pinned archive. Rule recorded in research/V6-RELEASE.md.
"""
from collections import defaultdict
import gzip
import hashlib
import json
import shutil
from unittest.mock import patch

from import_all_trophies import read_gzip_jsonl, write_gzip_jsonl, digest, render_replay
from model_training import V6_MODEL, V6_CORPUS, validate_training_manifest
from traditional_v4_revalidation import (build_v4_models, grader_for, interesting,
    cube_traditional_cohort, complete_source, CUBE)
from format_research import cohort
from traditional_puzzles import record, compare, THRESHOLDS
from v6_rebuild import ROOT, SOURCES, BUILD, read, write, phase_files, TRADITIONAL_PINS

SCHEMA = 'v6-traditional-rescore-v1'
ORIGINALS = ROOT/'generated/v6-original-traditional'
WINDOWS = {
    'phase2': {'component': 'traditional-premier-v6-phase2-v1', 'first': 1, 'last': 8, 'late': 7},
    'p1p6': {'component': 'traditional-premier-v6-p1p6-v1', 'first': 1, 'last': 6, 'late': None},
    'cube-p2p7': {'component': 'traditional-cube-p2p7-v6-v1', 'first': 2, 'last': 7, 'late': None},
}
FRESH_COMPONENT = 'traditional-premier-v6-fresh-measurement'


# Owner-approved windows. FRA's P1-P6 and Cube's P2-P7 are their existing
# approved restrictions; every other set uses the full regular window.
APPROVED = {CUBE: 'cube-p2p7', 'fra': 'p1p6'}


def approved_window(sid):
    return APPROVED.get(sid, 'phase2')


def evaluate(name, records, puzzles, complete_trajectories, snapshot=None):
    """Score one window with the unchanged gates; never fitted on these outcomes."""
    window = WINDOWS[name]
    inside = [r for r in records if window['first'] <= r['pick'] <= window['last']]
    chosen = [p for p in puzzles if window['first'] <= p['pick_number'] <= window['last']]
    width = window['last'] - window['first'] + 1
    unusable = 1 - len(chosen)/width/max(1, complete_trajectories)
    result = {'window': {'first_pick': window['first'], 'last_pick': window['last']},
              'all_picks': compare(inside), 'serving_picks': compare(interesting(inside)),
              'quality': {'usable_traditional_puzzles': len(chosen), 'unusable_fraction': unusable,
                          'pass': unusable <= THRESHOLDS['unusable_trajectory_fraction_max']}}
    checks = ['all_picks', 'serving_picks', 'quality']
    if window['late']:
        late = [r for r in inside if r['pick'] >= window['late']]
        result['late_picks'] = compare(late)
        result['serving_late_picks'] = compare(interesting(late))
        checks += ['late_picks', 'serving_late_picks']
    if snapshot is not None:
        result['snapshot'] = snapshot
        checks.append('snapshot')
    result['checks'] = checks
    result['failure_reasons'] = [f'{check}.{gate}' for check in checks if check != 'quality' and check != 'snapshot'
                                 for gate, ok in result[check].get('gates', {}).items() if not ok]
    result['failure_reasons'] += [check for check in ('quality', 'snapshot') if check in checks and not result[check]['pass']]
    result['pass'] = all(result[check]['pass'] for check in checks)
    return result


def admit(sid, records, puzzles, complete_trajectories, snapshot=None):
    """Score the approved window only; admitted if it passes, else not."""
    name = approved_window(sid)
    windows = {name: evaluate(name, records, puzzles, complete_trajectories, snapshot)}
    return windows, name if windows[name]['pass'] else None


def measure_fresh(sid, premier_pin, component_pin):
    """HOB only: build its original measured list from the current pinned archive."""
    import traditional_v4_revalidation as revalidation
    trad = component_pin['source_archive']
    sources = {premier_pin['source_archive']['url']: premier_pin['source_archive'],
               premier_pin['skill_source']['url']: premier_pin['skill_source'], trad['url']: trad}

    def frozen_archive(url, path, refresh=False):
        if url not in sources:
            raise ValueError('Unexpected archive substitution')
        shutil.copyfile(SOURCES/f'{sources[url]["sha256"]}.csv.gz', path)
        return dict(sources[url])
    manifest = BUILD/sid/'trophies'/sid/'manifest.json'
    pin = {**premier_pin, '_manifest_sha256': digest(manifest)}
    with patch.object(revalidation, 'archive', side_effect=frozen_archive):
        revalidation.measure(sid, ORIGINALS/sid, BUILD/sid/'trophies', premier_pin=pin,
                             trad_pin=trad, component=FRESH_COMPONENT)


def original_artifact(sid, premier_pin, component_pin):
    original = ORIGINALS/sid
    if component_pin['origin'] == 'fresh':
        measure_fresh(sid, premier_pin, component_pin)
    manifest = read(original/'manifest.json')
    if manifest['source_archive'] != component_pin['source_archive'] or manifest.get('id') != sid:
        raise ValueError(f'{sid}: measured Traditional source differs from its pin')
    expected = component_pin.get('artifact')
    if expected:
        for name, key in (('puzzles', 'puzzle_file_sha256'), ('trophies', 'ledger_file_sha256')):
            if digest(original/f'{name}.jsonl.gz') != expected[key] or manifest[key] != expected[key]:
                raise ValueError(f'{sid}: corrupt or substituted measured Traditional artifact')
    elif manifest.get('model_version') != V6_MODEL or manifest.get('parent_corpus_version') != V6_CORPUS:
        raise ValueError(f'{sid}: fresh measurement is not a v6 measurement')
    return original, manifest


def parity(sid, built):
    """Prove the independently reconstructed graders match the exact v10 import."""
    by_hash = {hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]: did for did in built['qualified']}
    count = 0
    with gzip.open(BUILD/sid/'trophies'/sid/'puzzles.jsonl.gz', 'rt') as handle:
        for line in handle:
            if not line.strip():
                continue
            puzzle = json.loads(line)
            did = by_hash[puzzle['source_draft_hash']]
            examples = [p for p in built['output'][did] if p.raw_pick_number == puzzle['pick_number']-1]
            if len(examples) != 1:
                raise ValueError('Missing v6 parity source')
            rendered = render_replay(did, examples, grader_for('PremierDraft', did, built), 1, 1, {})['picks'][0]
            if {c['name']: c['model_probability'] for c in rendered['candidates']} != \
                    {c['name']: c['model_probability'] for c in puzzle['candidates']}:
                raise ValueError(f'{sid}: reconstructed grader differs from exact v10 artifact')
            count += 1
            if count >= 256:
                break
    if count < 200:
        raise ValueError(f'{sid}: insufficient independent v6 grader parity')
    return count


def rescore(sid, premier_pin, component_pin, directory):
    validate_training_manifest(premier_pin, V6_MODEL)
    if premier_pin['corpus_version'] != V6_CORPUS:
        raise ValueError('Traditional graders must come from the v10 import')
    original, old_manifest = original_artifact(sid, premier_pin, component_pin)
    draft = SOURCES/f'{premier_pin["source_archive"]["sha256"]}.csv.gz'
    game = SOURCES/f'{premier_pin["skill_source"]["sha256"]}.csv.gz'
    trad = SOURCES/f'{component_pin["source_archive"]["sha256"]}.csv.gz'
    built = build_v4_models(sid, draft, game, premier_pin)
    parity_picks = parity(sid, built)
    old = read_gzip_jsonl(original/'puzzles.jsonl.gz')
    ledger = read_gzip_jsonl(original/'trophies.jsonl.gz')
    clean, trad_cohort = cube_traditional_cohort(trad, include_sources=True) if sid == CUBE \
        else cohort(trad, 'TradDraft', include_sources=True)
    drafts = trad_cohort.pop('sources')
    identities = {hashlib.sha256(f'{sid}|TradDraft|{did}'.encode()).hexdigest()[:32]: did for did in drafts}
    wanted = {identities[p['source_draft_hash']] for p in old}
    if set(clean) & built['training'] or not wanted.issubset(clean):
        raise ValueError('Traditional identity collision or inconsistent source')
    examples = {did: {p.raw_pick_number+1: p for p in picks} for did, picks in clean.items()}
    first, last = (2, 9) if sid == CUBE else (1, 8)
    records = []
    for did in sorted(built['qualified']):
        valid, _, reason = complete_source(built['output'][did], sid)
        if reason:
            continue
        for p in valid:
            if first <= p.raw_pick_number+1 <= last:
                records.append(record(sid, 'PremierDraft', did, p, grader_for('PremierDraft', did, built)))
    for did, picks in sorted(clean.items()):
        for p in picks:
            if first <= p.raw_pick_number+1 <= last:
                records.append(record(sid, 'TradDraft', did, p, grader_for('TradDraft', did, built)))
    rescored = []
    for previous in old:
        did = identities[previous['source_draft_hash']]
        p = examples[did][previous['pick_number']]
        historical = next(c['name'] for c in previous['candidates'] if c['id'] == previous['historical_pick_id'])
        prior = defaultdict(int)
        for card in previous['prior_picks']:
            prior[card['name']] += 1
        if p.historical_pick != historical or set(p.candidates) != {c['name'] for c in previous['candidates']} or dict(prior) != p.pool:
            raise ValueError(f'{sid}: measured Traditional source trajectory changed')
        rendered = render_replay(did, [p], grader_for('TradDraft', did, built), 1, 1, {})['picks'][0]
        support = {c['name']: c['model_probability'] for c in rendered['candidates']}
        rescored.append({**previous, 'candidates': [{**c, 'model_probability': support[c['name']]} for c in previous['candidates']]})
    snapshot = old_manifest.get('cube_snapshot') if sid == CUBE else None
    if sid == CUBE and not (snapshot or {}).get('pass'):
        raise ValueError('Powered Cube Premier/Traditional snapshot evidence is missing')
    windows, admitted = admit(sid, records, rescored, len(clean), snapshot)
    evidence = {'set': sid, 'model_version': V6_MODEL, 'parent_corpus_version': V6_CORPUS,
        'traditional_used_for_training': False, 'production_input_signature': premier_pin['input_signature'],
        'v6_parity_picks': parity_picks, 'fold_training_ids_sha256': [f['training_ids_sha256'] for f in built['fits']],
        'training_drafts': premier_pin['training_drafts'], 'qualified_training_drafts': premier_pin['qualified_training_drafts'],
        'training_picks': premier_pin['training_picks'], 'training_mode': 'all-qualified', 'training_cap': None,
        'traditional_cohort': trad_cohort, 'premier_source_audit': {'qualified_trophies': len(built['qualified']),
            'source_rows': built['source_rows']},
        'membership_origin': component_pin['origin'], 'source_membership_preserved': True,
        'historical_puzzle_file_sha256': digest(original/'puzzles.jsonl.gz'),
        'production_component': component_pin.get('production_component'),
        'windows': windows, 'admitted_window': admitted, 'pass': admitted is not None}
    directory.mkdir(parents=True, exist_ok=True)
    if admitted:
        window = WINDOWS[admitted]
        component, width = window['component'], window['last'] - window['first'] + 1
        restricted = width != (last - first + 1)
        chosen = []
        for puzzle in rescored:
            if window['first'] <= puzzle['pick_number'] <= window['last']:
                chosen.append({**puzzle, 'puzzle_id': hashlib.sha256(f'{component}|{puzzle["puzzle_id"]}'.encode()).hexdigest()[:32],
                    'research_puzzle_id': puzzle['puzzle_id'], 'corpus_version': component,
                    'parent_corpus_version': V6_CORPUS, 'model_version': V6_MODEL,
                    'model_input_signature': premier_pin['input_signature']})
        excluded = [n for n in range(first, last+1) if not window['first'] <= n <= window['last']]
        rows = []
        for row in ledger:
            if row.get('status') == 'included':
                row = {**row, 'puzzles': width, **({'excluded_pick_numbers': excluded} if restricted else {})}
            rows.append(row)
        if len(chosen) != width*sum(r.get('status') == 'included' for r in rows):
            raise ValueError(f'{sid}: admitted window source accounting is incomplete')
        write_gzip_jsonl(directory/'puzzles.jsonl.gz', chosen)
        write_gzip_jsonl(directory/'trophies.jsonl.gz', rows)
        manifest = {key: old_manifest[key] for key in ('id', 'model_source_event', 'source_event_type', 'source_archive', 'cube_snapshot')
                    if key in old_manifest}
        manifest.update({'component_version': component, 'model_version': V6_MODEL,
            'parent_corpus_version': V6_CORPUS, 'model_source_corpus': V6_CORPUS,
            'model_input_signature': premier_pin['input_signature'], 'v6_parity_picks': parity_picks,
            'serving_status': 'candidate', 'publication_authorized': False,
            'serving_window': windows[admitted]['window'], 'admission_policy': f'{admitted}-v6-admission-v1',
            'puzzles': len(chosen), 'puzzle_file_sha256': digest(directory/'puzzles.jsonl.gz'),
            'ledger_file_sha256': digest(directory/'trophies.jsonl.gz'),
            'fold_training_ids_sha256': evidence['fold_training_ids_sha256'],
            'training_mode': 'all-qualified', 'training_cap': None})
        write(directory/'manifest.json', manifest)
    write(directory/'summary.json', evidence)


def consolidate(build, output):
    pins = read(TRADITIONAL_PINS)['sets']
    evidence = {}
    for pin in pins:
        sid = pin['set_id']
        source = build/sid/'traditional'
        checkpoint = read(source/'checkpoint.json')
        premier = read(build/sid/'trophies'/sid/'manifest.json')
        summary = read(source/'summary.json')
        if checkpoint['identity'] != read(build/sid/'summary.json')['build_identity'] or checkpoint['files'] != phase_files(source):
            raise ValueError(f'{sid}: corrupt Traditional checkpoint')
        if summary['production_input_signature'] != premier['input_signature'] or summary['training_drafts'] != premier['training_drafts']:
            raise ValueError(f'{sid}: stale Traditional grader')
        if summary['pass'] != (source/'manifest.json').exists():
            raise ValueError(f'{sid}: admission decision differs from its artifact')
        if summary['pass']:
            shutil.copytree(source, output/sid, dirs_exist_ok=True)
        evidence[sid] = summary
    admitted = {s: e['admitted_window'] for s, e in evidence.items() if e['pass']}
    write(output/'report.json', {'schema': SCHEMA, 'model_version': V6_MODEL, 'parent_corpus_version': V6_CORPUS,
        'production_changed': False, 'publication_authorized': False,
        'traditional_used_for_training': False, 'source_membership_preserved': True,
        'expansion_supported': True, 'thresholds': THRESHOLDS, 'approved_windows': {**APPROVED, 'default': 'phase2'},
        'sets': evidence, 'admitted': admitted,
        'not_admitted': sorted(s for s, e in evidence.items() if not e['pass']),
        'newly_admitted': sorted(s for s in admitted if not evidence[s]['production_component']),
        'no_longer_admitted': sorted(s for s, e in evidence.items() if not e['pass'] and e['production_component'])})
