#!/usr/bin/env python3
"""Aggregate actual high-win-rate trophy draft decisions from pinned FRA archives.
No network, database, publication, draft IDs, or individual picks in output.
"""
from collections import Counter, defaultdict
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import os
import re

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'draft': 'f9497000be929d3f8cef87be643dc0b010e406a966ece7d0fc05e5e8e0c4b43d',
    'game': 'a350666bfd293bd14601105af0187f13353b16fa86e81307432a7b3a9a0bbfdc',
    'metadata': '5dee48cee16adf09b5c1003c4ef9af88a4951e4c24e7f7ba47283e444b80dfd7',
}
SOURCE = 'https://www.17lands.com/public_datasets'
METHOD = 'https://github.com/killjoy00/mtg-ev-analyzer/blob/main/research/pack-one-lab/README.md'
MIN_DRAFTS = 100
MIN_COVERAGE = .80

# Define every question before inspecting any result. One observation per draft
# per real pick. Rows from different pick positions are not independent.
SPECS = {
    'early-fixing': ('known multicolor-producing land offered beside a non-fixing card',
                     ['fixing land', 'other card']),
    'color-pivot': ('at least two prior ordinary colored spells, all one color; both same-color and new-color mono-color spells offered',
                    ['same-color spell', 'new-color spell', 'other card']),
    'colorless-flex': ('ordinary generic-mana spell offered beside a colored spell',
                       ['generic-mana spell', 'colored spell', 'other card']),
    'rarity-choice': ('common and rare/mythic nonland cards offered',
                      ['common spell', 'rare/mythic spell', 'other card']),
    'first-pick-abandon': ('first pick in a complete first-eight trophy trajectory with first-game deck observations',
                           ['first-pick card name observed', 'first-pick card name absent']),
}
LIMITS = {
    'early-fixing': 'Land-only proxy: does not include mana rocks, landcycling, Treasure or other fixing. Available alternatives differ by pick.',
    'color-pivot': 'Printed mana requirements only; picking a new color is not proof of abandoning the original color, or that a pivot was correct.',
    'colorless-flex': 'Generic-mana spell is a printed-cost proxy, not a guarantee of flexibility; alternative modes, abilities and castability are not inferred.',
    'rarity-choice': 'Rarity does not measure strength; the alternative cards and card counts vary by pick. No claim of over- or under-drafting.',
    'first-pick-abandon': 'Name inclusion in first match/first game is not copy-level inclusion or a final-deck guarantee; an absent name can reflect deck-building or missing records.',
}

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def checked(path, expected):
    if sha(path) != expected:
        raise ValueError('lab-source-hash-mismatch')

def role(card, context):
    # Conservative metadata classification. Unknown stays unknown, not false.
    ctx = context(card)
    if ctx['status'] != 'known':
        return None
    if ctx['land']:
        produced = ctx['produced_mana']
        return None if produced is None else {
            'land': True, 'fixing': len(set(produced) & set('WUBRG')) >= 2,
            'colors': (), 'generic': False, 'rarity': card.get('rarity')}
    cast = ctx['cast']
    return {'land': False, 'fixing': False, 'colors': tuple(cast['colors']),
            'generic': not cast['colors'] and not cast['colorless_pips'] and not cast['variable_cost'],
            'rarity': card.get('rarity')}

def opportunity(q, p, prior, roles):
    """Return (known, outcome) where None outcome means no qualifying opportunity."""
    offered = [roles.get(c) for c in p.candidates]
    chosen = roles.get(p.historical_pick)
    if not offered or chosen is None or any(c is None for c in offered):
        return False, None
    if q == 'early-fixing':
        if any(c['fixing'] for c in offered) and any(not c['fixing'] for c in offered):
            return True, 'fixing land' if chosen['fixing'] else 'other card'
    elif q == 'colorless-flex':
        if any(c['generic'] for c in offered) and any(c['colors'] for c in offered):
            return True, 'generic-mana spell' if chosen['generic'] else ('colored spell' if chosen['colors'] else 'other card')
    elif q == 'rarity-choice':
        spells = [c for c in offered if not c['land']]
        if any(c['rarity'] not in ('common','uncommon','rare','mythic') for c in spells):
            return False, None
        if any(c['rarity']=='common' for c in spells) and any(c['rarity'] in ('rare','mythic') for c in spells):
            return True, ('common spell' if not chosen['land'] and chosen['rarity']=='common' else
                          'rare/mythic spell' if not chosen['land'] and chosen['rarity'] in ('rare','mythic') else 'other card')
    elif q == 'color-pivot':
        if p.raw_pick_number < 2:
            return True, None
        prior_roles = [roles.get(c) for c in prior]
        if any(c is None for c in prior_roles):
            return False, None
        colored = [c['colors'] for c in prior_roles if c['colors']]
        union = {color for colors in colored for color in colors}
        if len(colored) >= 2 and len(union)==1:
            color = next(iter(union))
            def category(c):
                if len(c['colors']) != 1:
                    return 'other card'
                return 'same-color spell' if c['colors'][0]==color else 'new-color spell'
            categories = {category(c) for c in offered}
            if {'same-color spell','new-color spell'} <= categories:
                return True, category(chosen)
    else:
        raise ValueError('lab-unknown-question')
    return True, None

def cell():
    return {'eligible':0,'known':0,'outcomes':Counter()}

def summarize(groups, roles, decks):
    """groups: complete trajectories keyed by draft ID. IDs never leave here."""
    data = {q:defaultdict(cell) for q in SPECS}
    for did, picks in groups.items():
        picks = sorted(picks, key=lambda p:p.raw_pick_number)
        if len(picks)!=8 or any(p.raw_pack_number!=0 or p.raw_pick_number!=i or p.historical_pick not in p.candidates for i,p in enumerate(picks)):
            raise ValueError('lab-incomplete-trajectory')
        prior = []
        for i,p in enumerate(picks):
            for q in SPECS:
                if q=='first-pick-abandon':
                    if i!=0:
                        continue
                    c=data[q][1]; c['eligible']+=1
                    if did in decks:
                        c['known']+=1
                        c['outcomes']['first-pick card name observed' if p.historical_pick in decks[did] else 'first-pick card name absent']+=1
                    continue
                if q=='color-pivot' and i<2:
                    continue
                c=data[q][i+1]; c['eligible']+=1
                known,outcome=opportunity(q,p,prior,roles)
                c['known']+=int(known)
                if outcome is not None:
                    c['outcomes'][outcome]+=1
            prior.append(p.historical_pick)
    results=[]
    for q,(definition,labels) in SPECS.items():
        rows=[]
        for pick,c in sorted(data[q].items()):
            n=sum(c['outcomes'].values())
            coverage=c['known']/c['eligible']
            qualified=n>=MIN_DRAFTS and coverage>=MIN_COVERAGE
            row={'pick':pick,'eligible_drafts':c['eligible'],'known_drafts':c['known'],
                 'coverage':round(coverage,4),'qualifying_drafts':n,'qualified':qualified}
            # Suppress below-threshold outcomes, not just display them differently.
            if qualified:
                row['metrics']=[{'label':label,'numerator':c['outcomes'][label],
                                 'denominator':n,'percent':round(100*c['outcomes'][label]/n,1)}
                                for label in labels]
            else:
                row['reason']='insufficient-independent-drafts-or-metadata-coverage'
            rows.append(row)
        results.append({'id':q,'definition':definition,'unit':'distinct source draft at one real pick',
                        'limitation':LIMITS[q],'rows':rows,
                        'status':'candidate-evidence' if any(r['qualified'] for r in rows) else 'skip'})
    return results

def private_output(path):
    path=Path(path)
    parent=path.parent.resolve(strict=True)
    if ROOT==parent or ROOT in parent.parents or not parent.is_dir():
        raise ValueError('lab-private-output-required')
    if os.name!='nt' and parent.stat().st_mode & 0o077:
        raise ValueError('lab-private-output-required')
    if path.exists() or path.is_symlink():
        raise ValueError('lab-output-exists')
    return parent/path.name

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--draft',type=Path,required=True)
    p.add_argument('--game',type=Path,required=True)
    p.add_argument('--metadata',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    if os.getenv('GITHUB_ACTIONS'):
        raise ValueError('lab-private-output-required')
    output=private_output(args.out)
    for name in PINS:
        checked(getattr(args,name),PINS[name])
    # Reuse the repository's already-reviewed 17Lands parser, cohort selection,
    # complete first-eight trajectory validation, and first-game deck join.
    from format_research import cohort, first_game_decks
    from rules_mana_context import card_mana_context
    groups, report=cohort(args.draft,'PremierDraft')
    decks,_=first_game_decks(args.game,set(groups),'PremierDraft')
    with gzip.open(args.metadata,'rt',encoding='utf-8') as handle:
        metadata=json.load(handle)
    roles={name:role(card,card_mana_context) for name,card in metadata.items()}
    result={'schema_version':1,'source':'17Lands Reality Fracture PremierDraft archives, CC BY 4.0',
            'source_url':SOURCE,'methodology':METHOD,'source_sha256':PINS,
            'cohort':{'qualified_drafts':report['qualified_drafts'],
                      'qualified_trophies':report['qualified_trophies'],
                      'complete_trajectories':len(groups),'first_game_decks':len(decks),
                      'win_rate_cutoff':report['cutoff']},
            'status':'draft-evidence-only','sample_floor':MIN_DRAFTS,'metadata_coverage_floor':MIN_COVERAGE,
            'limitations':['Qualified trophy drafts only, not all experienced players or all Magic drafts.',
                           'Per-pick counts are descriptive. Cross-pick rows can share source drafts; no unpaired significance tests or causal inference.',
                           'First eight real picks only. Metadata with unsupported cards or missing rarity is excluded; the pinned FRA rules snapshot does not carry rarity.'],
            'results':summarize(groups,roles,decks)}
    # No ID-level data, raw rows or deck contents are serialized.
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        json.dump(result,handle,indent=2);handle.write('\n')
    print('Lab: aggregate-only trophy-pick evidence written privately; no publication.')

if __name__=='__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Lab stopped: check private output, source hashes and archive compatibility.')
