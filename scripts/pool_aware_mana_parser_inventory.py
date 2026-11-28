#!/usr/bin/env python3
"""Audit pinned rules before expensive validation; only metadata, never picks."""
import argparse
from collections import Counter
import json
from pathlib import Path

import pool_aware_mana_parser_v2 as parser
import pool_aware_skill_expansion as exp
import pool_aware_skill_recovery as rec
import pool_aware_skill_context_validation as ctx
from pool_aware_archive import read_json,sha256

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--fits',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();ctx.EXPECTED=set(exp.SETS)
    reports={}
    reviewers={'Eldrazi Ravager','Dig Through Time','Concealing Curtains','Junkblade Bruiser'}
    for sid in sorted(exp.SETS):
        origin='recovery' if sid in rec.RECOVER else 'expansion'
        folder=a.fits/origin/f'pool-aware-{origin}-report-{sid}'
        report=ctx.load_frozen(folder,sid);path=folder/'input/rules.json.gz'
        if sha256(path)!=report['provenance']['sources']['metadata']:
            raise ValueError('metadata checksum mismatch '+sid)
        rules=parser.index(read_json(path))
        transitions=Counter(c.previous_status+'->'+c.status for c in rules.cards.values())
        if transitions['readable->unreadable']:
            raise ValueError('previously readable metadata became unreadable '+sid)
        reports[sid]={'aliases':len(rules.cards),'transitions':dict(transitions),
            'unresolved_reasons':dict(Counter(n for c in rules.cards.values() if c.status=='unreadable' for n in c.notes)),
            'review_cards':{name:{'status':c.status,'previous_status':c.previous_status,
                'layout':c.layout,'costs':list(c.costs),'routes':[list(r) for r in c.routes],'notes':list(c.notes)}
                for name,c in rules.cards.items() if name in reviewers}}
    total=Counter()
    for r in reports.values():total.update(r['transitions'])
    out={'protocol':'mana-parser-v2-metadata-coverage','formats':len(reports),'alias_transitions':dict(total),
        'sets':reports,'note':'Aliases are metadata keys, not distinct card printings or offered picks.'}
    exp.write(a.output,out)
    print(json.dumps(out,indent=2),flush=True)

if __name__=='__main__':main()
