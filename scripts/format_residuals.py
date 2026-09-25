"""Matched card opportunities and source-clustered residuals; exploratory tags."""
from collections import defaultdict
import math
import random
import re
import statistics
import urllib.parse
from import_all_trophies import request

CATEGORIES=('fixing','multicolor','archetype_payoff','synergy','build_around','removal','bomb','sideboard','aggressive','controlling')
EVENTS=('PremierDraft','TradDraft')

def card_tags(card,bomb=False):
    text=(card.get('oracle_text') or ' '.join(f.get('oracle_text','') for f in card.get('card_faces',[]))).lower()
    kind=card.get('type_line','').lower();tags=set();colors=card.get('colors',card.get('color_identity',[]))
    if len(colors)>1:tags.add('multicolor')
    if 'any color' in text and ('add ' in text or 'mana' in text) or 'search your library' in text and 'land' in text:tags.add('fixing')
    if re.search(r'(destroy|exile) target (creature|permanent|artifact|enchantment)|deals? .*damage to (any target|target creature)|target creature gets -',text):tags.add('removal')
    if re.search(r'(destroy|exile) target (artifact|enchantment)|exile .*graveyard|protection from (white|blue|black|red|green)',text):tags.add('sideboard')
    if re.search(r'(whenever|if|for each).*(artifact|enchantment|token|graveyard|counter|creature type|you sacrifice)',text):tags.add('synergy')
    if re.search(r'(whenever|for each|as long as).*(you control|you cast|your graveyard)',text):tags.add('archetype_payoff')
    if 'synergy' in tags and ('whenever' in text or 'for each' in text) and ('enchantment' in kind or card.get('rarity') in ('rare','mythic')):tags.add('build_around')
    try:power=int(card.get('power',0))
    except (TypeError,ValueError):power=0
    if 'creature' in kind and ((card.get('cmc',99)<=3 and power>=2) or 'haste' in text):tags.add('aggressive')
    if 'removal' in tags or re.search(r'counter target spell|draw (two|three|four) cards|defender',text):tags.add('controlling')
    if bomb:tags.add('bomb')
    return sorted(tags)

def metadata_for_set(sid,model):
    url='https://api.scryfall.com/cards/search?'+urllib.parse.urlencode({'q':'set:'+sid,'unique':'cards'})
    cards={}
    while url:
        import json,time
        with request(url) as r:data=json.load(r)
        for card in data.get('data',[]):
            cards[card['name']]=card
            for face in card.get('card_faces',[]):cards.setdefault(face['name'],card)
        url=data.get('next_page') if data.get('has_more') else None
        if url:time.sleep(.15)
    rates=sorted(model.base_tendency(c,0,0) for c in model.all.global_seen)
    threshold=rates[int(.9*(len(rates)-1))] if rates else math.inf
    return {name:card_tags(c,model.base_tendency(name,0,0)>=threshold and name in model.all.global_seen) for name,c in cards.items()}

def cell_key(record,card):
    commitment=record['commitments'].get(card)
    if commitment is None:return None
    return (card,0 if record['pick']<=2 else 1 if record['pick']<=5 else 2,0 if commitment<=1 else 1 if commitment<=3 else 2)

def estimate_cells(cells,seed=20260918,draws=500):
    matched=[v for v in cells if all(len(v.get(e,[]))>=20 for e in EVENTS)]
    if not matched:return {'matched_cells':0,'interval':None}
    weights=[min(len(c[e]) for e in EVENTS) for c in matched];total=sum(weights)
    difference=0;influence={e:defaultdict(float) for e in EVENTS};counts={e:0 for e in EVENTS}
    for cell,w in zip(matched,weights):
        for event,sign in zip(EVENTS,(-1,1)):
            values=cell[event];mean=statistics.fmean(v for _,v in values);difference+=sign*w*mean/total;counts[event]+=len(values)
            for draft,value in values:influence[event][draft]+=sign*w*(value-mean)/(total*len(values))
    rng=random.Random(seed);samples=[]
    for _ in range(draws):
        samples.append(difference+sum(sum(rng.choices(list(v.values()),k=len(v))) for v in influence.values()))
    samples.sort()
    return {'matched_cells':len(matched),'opportunities':counts,'drafts':{e:len(v) for e,v in influence.items()},'difference_traditional_minus_premier':difference,'interval':[samples[int(.025*draws)],samples[min(draws-1,int(.975*draws))]]}

def residual_report(reports):
    by_set={};coverage={};all_cards={}
    for report in reports:
        cells=defaultdict(lambda:defaultdict(list));unknown=0;opportunities=0
        tags=report.get('card_tags',{})
        for record in report['tests']:
            for i,card in enumerate(record['cards']):
                opportunities+=1;key=cell_key(record,card)
                if key is None or card not in tags:unknown+=1;continue
                cells[key][record['event']].append((record['draft'],int(i==record['chosen'])-record['combined'][i]))
        categories={name:estimate_cells([v for key,v in cells.items() if name in tags.get(key[0],[])]) for name in CATEGORIES}
        cards={name:estimate_cells([v for key,v in cells.items() if key[0]==name],draws=200) for name in {key[0] for key in cells}}
        by_set[report['set']]=categories;all_cards[report['set']]={k:v for k,v in cards.items() if v['matched_cells']}
        coverage[report['set']]={'candidate_opportunities':opportunities,'unknown_color_or_missing_metadata':unknown,'matched_cells':sum(all(len(v.get(e,[]))>=20 for e in EVENTS) for v in cells.values())}
    patterns=[];coverage_ok=True
    for name in CATEGORIES:
        available=[(sid,v[name]) for sid,v in by_set.items() if v[name]['interval']]
        coverage_ok=coverage_ok and len(available)>=3
        for sign in (-1,1):
            stable=[sid for sid,r in available if sign*r['difference_traditional_minus_premier']>=.03 and (r['interval'][0]>0 if sign==1 else r['interval'][1]<0)]
            if len(stable)>=3:patterns.append({'category':name,'direction':'Traditional higher' if sign==1 else 'Premier higher','sets':stable})
    return {'definition':'Observed choice minus calibrated combined-model probability, matched on card, set, pick range and color commitment. Intervals cluster source drafts, conditional on matched opportunity cells. Card intervals are exploratory, not multiplicity-adjusted evidence of a format difference.','categories_by_set':by_set,'cards_by_set':all_cards,'coverage':coverage,'all_categories_have_three_sets':coverage_ok,'persistent_category_patterns':patterns}
