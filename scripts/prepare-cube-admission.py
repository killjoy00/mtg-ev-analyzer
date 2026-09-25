#!/usr/bin/env python3
"""Convert pinned Phase 2 evidence to the owner-approved P2-P7 inventory. No model fit."""
import argparse,gzip,hashlib,json
from pathlib import Path
from traditional_puzzles import compare,THRESHOLDS
from build_replays import MODEL_VERSION
from import_all_trophies import atomic_json,write_gzip_jsonl,digest,encoded
COMPONENT='traditional-cube-p2p7-v3-v1'
PINS={'puzzles.jsonl.gz':'f0a752a0eec4608222b1cfa0f2db5a7008f78cad3b0057ef0c6eda3b6f410b73','trophies.jsonl.gz':'99968c1f3fc69e9aa7a0538be623a1209e080c6a23e57d37585f89765088d1e3','measurements.json.gz':'80ed1c5f38004e56ddc68b7cdf6deb0bcdb575ca4c7b8840e2ad5f47263216ed'}
def prepare(source,out):
 m=json.loads((source/'manifest.json').read_text())
 for name,sha in PINS.items():
  if digest(source/name)!=sha:raise ValueError('Pinned Cube research file changed: '+name)
 evidence=json.load(gzip.open(source/'measurements.json.gz','rt'))
 if evidence['model_training_changed'] or evidence['model_version']!=MODEL_VERSION or evidence['parity_picks']!=9344 or not evidence['cube_snapshot']['pass']:raise ValueError('Frozen Cube evidence unavailable')
 def interesting(r):
  ps=sorted(r['raw'],reverse=True);return ps[0]<=.75 and ps[1]/ps[0]>=.2
 tests=evidence['tests'];selected=[r for r in tests if 2<=r['pick']<=7]
 all_picks=compare(selected);serving=compare([r for r in selected if interesting(r)])
 if not all_picks['pass'] or not serving['pass']:raise ValueError('Admission window failed unchanged gates')
 rejected={str(p):compare([r for r in tests if r['pick']==p]) for p in (8,9)}
 rejected['8-9']=compare([r for r in tests if r['pick']>=8])
 rows=[json.loads(line) for line in gzip.open(source/'puzzles.jsonl.gz','rt')]
 chosen=[p for p in rows if 2<=p['pick_number']<=7]
 if len(chosen)!=1320 or len({p['source_draft_hash'] for p in chosen})!=220:raise ValueError('Cube inventory differs')
 for p in chosen:
  p['research_puzzle_id']=p['puzzle_id'];p['puzzle_id']=hashlib.sha256(f"{COMPONENT}|{p['puzzle_id']}".encode()).hexdigest()[:32];p['corpus_version']=COMPONENT
 ledger=[json.loads(line) for line in gzip.open(source/'trophies.jsonl.gz','rt')]
 for d in ledger:
  if d['status']=='included':d['puzzles']=6;d['excluded_pick_numbers']=[8,9]
 out.mkdir(parents=True,exist_ok=True);dest=out/'powered-cube';dest.mkdir(exist_ok=True)
 write_gzip_jsonl(dest/'puzzles.jsonl.gz',chosen);write_gzip_jsonl(dest/'trophies.jsonl.gz',ledger)
 report={'schema':'cube-p2p7-admission-v1','production_changed':False,'model_training_changed':False,'expansion_supported':True,'thresholds':THRESHOLDS,'source_run':35386149822,'source_artifact':10564446647,'source_measurements_sha256':digest(source/'measurements.json.gz'),'decision':'Owner-approved restricted admission after full P2-P9 late-window failure; no threshold changes and no per-pick selection rule.','rejected_picks':rejected,'sets':{'powered-cube':{'all_picks':all_picks,'serving_picks':serving,'quality':{**evidence['quality'],'usable_traditional_puzzles':1320},'snapshot':evidence['cube_snapshot'],'traditional_cohort':evidence['traditional_cohort'],'parity_picks':evidence['parity_picks'],'frozen_input_signature':evidence['frozen_input_signature'],'premier_source_audit':evidence['premier_source_audit']}}}
 atomic_json(out/'report.json',report)
 manifest={**m,'component_version':COMPONENT,'puzzles':1320,'serving_window':{'first_pick':2,'last_pick':7},'admission_policy':'cube-p2p7-admission-v1','research_component_version':m['component_version'],'puzzle_file_sha256':digest(dest/'puzzles.jsonl.gz'),'ledger_file_sha256':digest(dest/'trophies.jsonl.gz'),'research_report_sha256':digest(out/'report.json')}
 atomic_json(dest/'manifest.json',manifest)
 print(json.dumps({'puzzles':1320,'sources':220,'servable':serving['summaries']['TradDraft']['picks'],'all_pass':all_picks['pass'],'servable_pass':serving['pass'],'excluded':[8,9]}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();prepare(a.source,a.output)
