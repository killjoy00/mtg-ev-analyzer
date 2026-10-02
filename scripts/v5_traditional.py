"""Rescore the exact admitted Traditional source decisions with v5 Premier graders.

No Traditional observation is used for fitting. Frozen eligibility, trajectories,
Cube P2-P7 window and quality thresholds remain unchanged. Probability and gate
changes are measured after the full v5 build, not used for model selection.
"""
from collections import defaultdict
import csv
import gzip
import hashlib
import json
from pathlib import Path

from import_all_trophies import (read_gzip_jsonl, write_gzip_jsonl, digest,
    rows, scan_metadata, candidate_columns, pool_columns, parse_example, render_replay)
from model_training import V5_MODEL, V5_CORPUS, validate_training_manifest
from traditional_v4_revalidation import build_v4_models, grader_for, interesting, cube_traditional_cohort, complete_source
from format_research import cohort
from traditional_puzzles import record, compare, THRESHOLDS
from v5_rebuild import ROOT, SOURCES, read, write, phase_files, COMPONENT_PINS

SCHEMA = 'v5-traditional-rescore-v1'


def rescore(sid, premier_pin, component_pin, directory):
    validate_training_manifest(premier_pin)
    original = ROOT/'generated/v5-original-traditional'/sid
    if sid=='powered-cube':
        from prepare_v4_cube_admission import prepare
        admission = ROOT/'generated/v5-original-cube-admission'
        prepare(original,admission)
        original = admission/sid
    old_manifest = read(original/'manifest.json')
    expected = component_pin['manifest']
    for key in ('source_archive','puzzle_file_sha256','ledger_file_sha256'):
        if old_manifest[key] != expected[key]:
            raise ValueError(f'{sid}: admitted Traditional source artifact differs: {key}')
    for name,key in (('puzzles','puzzle_file_sha256'),('trophies','ledger_file_sha256')):
        if digest(original/f'{name}.jsonl.gz')!=expected[key]:
            raise ValueError(f'{sid}: corrupt historical Traditional artifact')
    draft = SOURCES/f'{premier_pin["source_archive"]["sha256"]}.csv.gz'
    game = SOURCES/f'{premier_pin["skill_source"]["sha256"]}.csv.gz'
    trad = SOURCES/f'{expected["source_archive"]["sha256"]}.csv.gz'
    built = build_v4_models(sid,draft,game,premier_pin)
    # Prove these independently reconstructed graders match the exact v9 import.
    def v9_records():
        with gzip.open(ROOT/'generated/v5-build'/sid/'trophies'/sid/'puzzles.jsonl.gz','rt') as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)
    by_hash = {hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]:did
               for did in built['qualified']}
    parity = 0
    for puzzle in v9_records():
        did = by_hash[puzzle['source_draft_hash']]
        examples = [p for p in built['output'][did] if p.raw_pick_number==puzzle['pick_number']-1]
        if len(examples)!=1:
            raise ValueError('Missing v5 parity source')
        rendered = render_replay(did,examples,grader_for('PremierDraft',did,built),1,1,{})['picks'][0]
        if {c['name']:c['model_probability'] for c in rendered['candidates']} != {c['name']:c['model_probability'] for c in puzzle['candidates']}:
            raise ValueError(f'{sid}: reconstructed grader differs from exact v9 artifact')
        parity += 1
        if parity>=256:
            break
    if parity<200:
        raise ValueError(f'{sid}: insufficient independent v5 grader parity')
    old = read_gzip_jsonl(original/'puzzles.jsonl.gz')
    ledger = read_gzip_jsonl(original/'trophies.jsonl.gz')
    clean,trad_cohort = cube_traditional_cohort(trad,include_sources=True) if sid=='powered-cube' else cohort(trad,'TradDraft',include_sources=True)
    drafts = trad_cohort.pop('sources')
    identities = {hashlib.sha256(f'{sid}|TradDraft|{did}'.encode()).hexdigest()[:32]:did
                  for did in drafts}
    wanted = {identities[p['source_draft_hash']] for p in old}
    if set(clean) & built['training'] or not wanted.issubset(clean):
        raise ValueError('Traditional identity collision or inconsistent source')
    examples = {did:{p.raw_pick_number+1:p for p in picks} for did,picks in clean.items()}
    component = 'traditional-cube-p2p7-v5-v1' if sid=='powered-cube' else 'traditional-premier-v5-phase2-v1'
    puzzles,records = [],[]
    first,last = (2,7) if sid=='powered-cube' else (1,8)
    for did in sorted(built['qualified']):
        valid,_,reason = complete_source(built['output'][did],sid)
        if reason:
            continue
        for p in valid:
            if first<=p.raw_pick_number+1<=last:
                records.append(record(sid,'PremierDraft',did,p,grader_for('PremierDraft',did,built)))
    for did,picks in sorted(clean.items()):
        for p in picks:
            if first<=p.raw_pick_number+1<=last:
                records.append(record(sid,'TradDraft',did,p,grader_for('TradDraft',did,built)))
    for previous in old:
        did = identities[previous['source_draft_hash']]
        p = examples[did][previous['pick_number']]
        historical = next(c['name'] for c in previous['candidates'] if c['id']==previous['historical_pick_id'])
        prior = defaultdict(int)
        for card in previous['prior_picks']:
            prior[card['name']] += 1
        if p.historical_pick != historical or set(p.candidates)!={c['name'] for c in previous['candidates']} or dict(prior)!=p.pool:
            raise ValueError(f'{sid}: admitted Traditional source trajectory changed')
        model = grader_for('TradDraft',did,built)
        rendered = render_replay(did,[p],model,1,1,{})['picks'][0]
        support = {c['name']:c['model_probability'] for c in rendered['candidates']}
        puzzle = {**previous,'puzzle_id':hashlib.sha256(f'{component}|{previous["puzzle_id"]}'.encode()).hexdigest()[:32],
            'corpus_version':component,'parent_corpus_version':V5_CORPUS,
            'model_version':V5_MODEL,'model_input_signature':premier_pin['input_signature'],
            'candidates':[{**c,'model_probability':support[c['name']]} for c in previous['candidates']]}
        puzzles.append(puzzle)
    evidence = {'set':sid,'model_version':V5_MODEL,'parent_corpus_version':V5_CORPUS,
        'traditional_used_for_training':False,'production_input_signature':premier_pin['input_signature'],
        'v5_parity_picks':parity,'fold_training_ids_sha256':[f['training_ids_sha256'] for f in built['fits']],
        'training_drafts':premier_pin['training_drafts'],'qualified_training_drafts':premier_pin['qualified_training_drafts'],
        'training_picks':premier_pin['training_picks'],'training_mode':'all-qualified','training_cap':None,
        'traditional_cohort':trad_cohort,
        'premier_source_audit':{'qualified_trophies':len(built['qualified']),
            'source_rows':built['source_rows']},
        'all_picks':compare(records),'serving_picks':compare(interesting(records)),
        'quality':{'usable_traditional_puzzles':len(puzzles),
            'unusable_fraction':1-len(puzzles)/(last-first+1)/max(1,len(clean))},
        'source_membership_preserved':True,'historical_puzzle_file_sha256':expected['puzzle_file_sha256'],
        'source_status':component_pin['status']}
    evidence['quality']['pass'] = evidence['quality']['unusable_fraction'] <= THRESHOLDS['unusable_trajectory_fraction_max']
    if sid=='powered-cube':
        evidence['snapshot'] = expected['cube_snapshot']
    else:
        evidence['late_picks'] = compare([r for r in records if r['pick']>=7])
        evidence['serving_late_picks'] = compare([r for r in interesting(records) if r['pick']>=7])
    checks = ['all_picks','serving_picks','quality'] + (['snapshot'] if sid=='powered-cube' else ['late_picks','serving_late_picks'])
    evidence['pass'] = all(evidence[c]['pass'] for c in checks)
    directory.mkdir(parents=True,exist_ok=True)
    # The ledger and source membership remain byte-identical to the admitted input.
    import shutil
    shutil.copyfile(original/'trophies.jsonl.gz',directory/'trophies.jsonl.gz')
    write_gzip_jsonl(directory/'puzzles.jsonl.gz',puzzles)
    manifest = {**expected,'component_version':component,'model_version':V5_MODEL,
        'parent_corpus_version':V5_CORPUS,'model_source_corpus':V5_CORPUS,
        'model_input_signature':premier_pin['input_signature'],'v5_parity_picks':parity,
        'puzzle_file_sha256':digest(directory/'puzzles.jsonl.gz'),
        'ledger_file_sha256':digest(directory/'trophies.jsonl.gz'),
        'fold_training_ids_sha256':evidence['fold_training_ids_sha256'],
        'training_mode':'all-qualified','training_cap':None,'source_status':component_pin['status']}
    if sid=='powered-cube':
        manifest['admission_policy']='cube-p2p7-v5-admission-v1'
    for key in ('v8_parity_picks','research_report_sha256'):
        manifest.pop(key,None)
    write(directory/'manifest.json',manifest)
    write(directory/'summary.json',evidence)


def consolidate(build,output):
    import shutil
    pins = read(COMPONENT_PINS)['sets']
    evidence = {}
    for pin in pins:
        sid = pin['set_id']
        source = build/sid/'traditional'
        checkpoint = read(source/'checkpoint.json')
        premier = read(build/sid/'trophies'/sid/'manifest.json')
        summary = read(source/'summary.json')
        if checkpoint['identity']!=read(build/sid/'summary.json')['build_identity'] or checkpoint['files'] != phase_files(source):
            raise ValueError(f'{sid}: corrupt Traditional checkpoint')
        if summary['production_input_signature']!=premier['input_signature'] or summary['training_drafts']!=premier['training_drafts']:
            raise ValueError(f'{sid}: stale Traditional grader')
        shutil.copytree(source,output/sid,dirs_exist_ok=True)
        evidence[sid]=read(source/'summary.json')
    write(output/'report.json',{'schema':SCHEMA,'model_version':V5_MODEL,'parent_corpus_version':V5_CORPUS,
        'production_changed':False,'publication_authorized':False,
        'traditional_used_for_training':False,'source_membership_preserved':True,
        'expansion_supported':True,'thresholds':THRESHOLDS,'sets':evidence,
        'passing_sets':[s for s,e in evidence.items() if e['pass']],
        'failing_sets':[s for s,e in evidence.items() if not e['pass']]})
