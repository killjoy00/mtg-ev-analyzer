"""Printed mana requirements and alternative casting routes for v7.

This is a versioned replacement for the deliberately restrictive research
extractor. Do not edit the frozen pool_aware_features.py or its source lock.
A route describes printed mana choices, not proof of castability.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import math
import re

import pool_aware_features as old

COLORS=old.COLORS
# W,U,B,R,G, required colorless, snow, Phyrexian life payments, generic, variable.
SYMBOLS=COLORS+'CS'
WIDTH=10
ZERO=(0,)*WIDTH
TOKEN=re.compile(r'\{([^{}]+)\}')
MAX_ROUTES=512
# Only layouts with a known choice of spell faces; transform/flip/battle
# back faces are not interchangeable hand-cast spell alternatives.
CHOICE_LAYOUTS={'split','adventure','modal_dfc'}
FRONT_LAYOUTS={'transform','flip','battle','meld'}
SPECIAL_LAYOUTS=CHOICE_LAYOUTS|FRONT_LAYOUTS

@dataclass(frozen=True)
class Cost:
    routes: tuple[tuple[int,...],...]

@dataclass(frozen=True)
class Card:
    status: str
    routes: tuple[tuple[int,...],...]
    mandatory: tuple[int,...]
    fixing: frozenset[str]
    previous_status: str
    layout: str
    costs: tuple[str,...]
    notes: tuple[str,...]

def symbol_route(symbol):
    a=[0]*WIDTH
    if symbol in SYMBOLS and len(symbol)==1:
        a[SYMBOLS.index(symbol)]=1
    elif re.fullmatch(r'[0-9]+',symbol):
        a[8]=int(symbol)
    elif symbol in ('X','Y','Z'):
        a[9]=1
    elif symbol=='P':
        a[7]=1
    else:
        return None
    return tuple(a)

def options(token):
    if '/' not in token:
        if token=='P':
            return None
        route=symbol_route(token)
        return (route,) if route is not None else None
    parts=token.split('/')
    if len(set(parts))!=len(parts):
        return None
    # Colored hybrid, two-brid, colorless hybrid and Phyrexian variants.
    # P is an alternative life payment, never a sixth mana color.
    colored=sum(p in COLORS and len(p)==1 for p in parts)
    if len(parts)==2 and colored>=1 and all(p in tuple(COLORS)+('2','P','C') for p in parts):
        return tuple(symbol_route(p) for p in parts)
    if len(parts)==3 and colored==2 and 'P' in parts:
        return tuple(symbol_route(p) for p in parts)
    return None

def parse_cost(cost):
    if not isinstance(cost,str) or not cost:
        return None # no printed mana cost is not a zero-cost spell
    tokens=TOKEN.findall(cost)
    if not tokens or ''.join('{'+t+'}' for t in tokens)!=cost:
        return None
    routes={ZERO}
    for token in tokens:
        choices=options(token)
        if choices is None:
            return None
        routes={tuple(x+y for x,y in zip(a,b)) for a in routes for b in choices}
        if len(routes)>MAX_ROUTES:
            return None # bound unusual symbols/combinatorics, never guess
    return Cost(tuple(sorted(routes)))

def is_land(face):
    line=face.get('type_line') if isinstance(face,dict) else None
    return isinstance(line,str) and bool(line) and '//' not in line and 'Land' in line.split(' — ')[0].split()

def previous_status(card):
    if isinstance(card,dict):
        faces=card.get('card_faces') or [card]
        if isinstance(faces,list) and all(is_land(f) for f in faces):
            return 'land'
    return 'readable' if old.spell_pips(card) is not None else 'unreadable'

def parse_card(card):
    prev=previous_status(card)
    # Retain the original, conservative fixing detector unchanged. This is
    # a mana parser fix, not a new fetch/treasure/ramp model.
    fixing=old.fixing_colors(card)
    if not isinstance(card,dict):
        return Card('unreadable',(),ZERO[:5],fixing,prev,'missing',(),('missing_metadata',))
    layout=str(card.get('layout') or 'unspecified')
    notes=[]
    raw=card.get('card_faces')
    if raw:
        if not isinstance(raw,list) or any(not isinstance(f,dict) for f in raw):
            return Card('unreadable',(),ZERO[:5],fixing,prev,layout,(),('malformed_faces',))
        if layout in FRONT_LAYOUTS:
            faces=raw[:1]
        elif layout in CHOICE_LAYOUTS:
            faces=raw
            if layout=='split':
                # Aftermath's second half is cast from the graveyard only.
                faces=[f for i,f in enumerate(faces) if i==0 or not re.search(r'(?im)^\s*Aftermath\b',str(f.get('oracle_text','')))]
        else:
            return Card('unreadable',(),ZERO[:5],fixing,prev,layout,(),('unsupported_face_layout',))
    else:
        # Real printed top-level costs are valid even on non-normal layouts.
        # Display-only composite faces cannot establish castable face modes.
        if '//' in str(card.get('type_line','')):
            return Card('unreadable',(),ZERO[:5],fixing,prev,layout,(),('missing_rules_faces',))
        faces=[card]
    spells=[f for f in faces if not is_land(f)]
    has_land=any(is_land(f) for f in faces)
    if not spells and has_land:
        return Card('land',(),ZERO[:5],fixing,prev,layout,(),())
    routes=set();costs=[];unresolved=0
    for face in spells:
        typ=face.get('type_line')
        cost=face.get('mana_cost')
        if not isinstance(typ,str) or not typ or '//' in typ:
            unresolved+=1;continue
        parsed=parse_cost(cost)
        if parsed is None:
            unresolved+=1;continue
        costs.append(cost);routes.update(parsed.routes)
    if not routes:
        return Card('unreadable',(),ZERO[:5],fixing,prev,layout,tuple(costs),('unresolved_printed_cost',))
    if unresolved:notes.append('some_spell_faces_unresolved')
    if has_land:notes.append('optional_land_face')
    if any(r[5] for r in routes):notes.append('requires_or_offers_colorless')
    if any(r[6] for r in routes):notes.append('requires_or_offers_snow')
    if any(r[7] for r in routes):notes.append('offers_life_payment')
    if any(r[9] for r in routes):notes.append('variable_generic_cost')
    # Count only genuinely mandatory prior colors, not both colors of a
    # hybrid symbol or every color in an adventure/split card. A land/spell
    # MDFC or unresolved spell mode does not establish a prior commitment.
    required=ZERO[:5] if has_land or unresolved else tuple(min(r[i] for r in routes) for i in range(5))
    return Card('readable',tuple(sorted(routes)),required,fixing,prev,layout,tuple(costs),tuple(notes))

class RulesIndex:
    """Compile once per set; per-pick evaluation has no regex/JSON parsing."""
    def __init__(self,metadata):
        self.cards={n:parse_card(card) for n,card in metadata.items()}
        self.missing=parse_card(None)
    def get(self,name):
        return self.cards.get(name,self.missing)

def index(metadata):
    return metadata if isinstance(metadata,RulesIndex) else RulesIndex(metadata)

def requirements(route):
    return {c:route[i] for i,c in enumerate(COLORS) if route[i]}

def best_route(card,access):
    """Select a plausible printed spell mode for color-fit only.
    Minimize missing WUBRG pips, prefer fewer unknown special/life payments,
    then more supported pips. Stable ties. C/S are retained as separate
    requirements; we make no assertion that a source or life total exists.
    """
    if not card.routes:return None
    def key(r):
        return (sum(r[i] for i,c in enumerate(COLORS) if c not in access),
                sum(bool(r[i]) for i,c in enumerate(COLORS) if c not in access),
                r[5]+r[6],r[7],
                -sum(r[i] for i,c in enumerate(COLORS) if c in access),
                r[8],r[9],r)
    return requirements(min(card.routes,key=key))

def extract(pool,candidates,support,metadata,interactions=()):
    if interactions:
        raise ValueError('v7 parser does not change synergy features')
    if len(candidates)!=len(support) or not candidates or len(set(candidates))!=len(candidates):
        raise ValueError('invalid candidate alignment')
    if any(p<=0 or not math.isfinite(p) for p in support):
        raise ValueError('invalid raw support')
    rules=index(metadata)
    prior=[rules.get(n) for n in pool]; available=[rules.get(n) for n in candidates]
    # Original feature scaling; preserve exact behavior for ordinary cards
    # with ordinary printed costs and the same fixing evidence.
    prior_pips=[requirements(c.mandatory) for c in prior if any(c.mandatory)]
    demand=Counter(c for p in prior_pips for c in p)
    sources=Counter(c for p in prior for c in p.fixing)
    stage=min(1.,len(prior)/8.)
    commitment=min(1.,max(0.,(len(prior_pips)-2)/4.))
    concentration=sum(demand[c] for c in COLORS if demand[c]>=2)/max(1,sum(demand.values()))
    known_context=sum(c.status=='readable' or bool(c.fixing) for c in prior)/max(1,len(prior))
    strength=stage*commitment*concentration*known_context
    access={c for c in COLORS if demand[c] or sources[c]}
    pips=[best_route(c,access) for c in available]
    fully_supported=[bool(p) and set(p)<=access for p in pips]
    leader=max(support);rows=[]
    for i,(card,req) in enumerate(zip(available,pips)):
        supported=single=multiple=multi_color=utility=cost=0.
        if req:
            needed=sum(req.values())
            supported=strength*sum(n for c,n in req.items() if c in access)/needed
            missing=[c for c in req if c not in access]
            single=strength*sum(req[c]==1 for c in missing)/max(1,len(req))
            multiple=strength*sum(req[c] for c in missing if req[c]>1)/needed
            multi_color=strength*max(0,len(missing)-1)/max(1,len(req)-1)
            competing=max((p/leader for j,p in enumerate(support) if j!=i and fully_supported[j]),default=0.)
            cost=competing*strength*sum(req[c] for c in missing)/needed
        if len(card.fixing)>=2 and demand:
            utility=stage*sum(demand[c]/(1+sources[c]) for c in card.fixing)/sum(demand.values())
        rows.append((supported,single,multiple,multi_color,utility,cost,0.,0.))
    return tuple(rows),{'unknown_candidates':sum(c.layout=='missing' for c in available),
        'unresolved_spell_costs':sum(c.status=='unreadable' for c in available),
        'unknown_prior':sum(c.status=='unreadable' for c in prior),
        'recovered_costs':sum(c.previous_status=='unreadable' and c.status=='readable' for c in available)}

def self_test():
    def card(cost,line='Creature',text='',layout='normal',**kw):
        return dict(id='synthetic',layout=layout,type_line=line,mana_cost=cost,oracle_text=text,**kw)
    assert parse_cost('{X}{2}{U}{C}').routes==((0,1,0,0,0,1,0,0,2,1),)
    assert parse_cost('{S}').routes[0][6]==1
    assert parse_cost('{0}').routes==(ZERO,)
    assert parse_cost('') is None and parse_cost('{T}') is None
    assert parse_cost('{W/U}{W/U}') is not None and len(parse_cost('{W/U}{W/U}').routes)==3
    assert len(parse_cost('{W/U/P}').routes)==3
    assert parse_cost('{2/W}').routes[0][8]==2
    assert parse_cost('{P}') is None and parse_cost('{W/garbage}') is None
    hybrid=parse_card(card('{W/U}'))
    assert hybrid.status=='readable' and not any(hybrid.mandatory)
    assert best_route(hybrid,{'U'})=={'U':1} and best_route(hybrid,{'W'})=={'W':1}
    assert sum(best_route(hybrid,{'R'}).values())==1
    assert best_route(parse_card(card('{2/W}')),{'U'})=={}
    assert best_route(parse_card(card('{W/P}')),{'U'})=={}
    for mechanic in ('Cycling {2}','Delve','Flashback {3}{U}','Kicker {R}','Prototype {2}{U}'):
        c=parse_card(card('{4}{U}',text=mechanic))
        assert c.status=='readable' and c.mandatory[1]==1
    front=card('{B}');back=card('{R}{R}')
    transform=parse_card(card('',layout='transform',card_faces=[front,back]))
    assert transform.mandatory[2]==1 and transform.mandatory[3]==0 and best_route(transform,{'R'})=={'B':1}
    adventure=parse_card(card('',layout='adventure',card_faces=[front,back]))
    assert not any(adventure.mandatory) and best_route(adventure,{'R'})=={'R':2}
    mdfc=parse_card(card('',layout='modal_dfc',card_faces=[front,card('',line='Land')]))
    assert not any(mdfc.mandatory) and best_route(mdfc,{'B'})=={'B':1}
    split=parse_card(card('',layout='split',card_faces=[front,card('{R}',text='Aftermath')]))
    assert best_route(split,{'R'})=={'B':1}
    assert parse_card(card('',line='Land')).status=='land'
    assert parse_card(card('{C}')).status=='readable'
    assert parse_card(card('{2}{U}',layout='saga')).status=='readable'
    assert parse_card(card('',layout='unknown',card_faces=[front,back])).status=='unreadable'
    meta={'u':card('{U}'),'b':card('{B}{B}'),'land':card('',line='Land',text='{T}: Add {U} or {B}.',produced_mana=['U','B']),
          'generic':card('{2}')}
    pool=('u',)*6;names=('u','b','land','generic');support=(.4,.3,.2,.1)
    a,_=old.extract(pool,names,support,meta);b,_=extract(pool,names,support,meta)
    assert a==b
    meta.update({'hybrid':card('{U/R}'),'cycle':card('{4}{U}',text='Cycling {2}'),'delve':card('{6}{U}{U}',text='Delve'),
                 'phyrexian':card('{R/P}'),'c':card('{C}'),'x':card('{X}{U}')})
    names=('hybrid','cycle','delve','phyrexian','c','x','unknown')
    f,c=extract(pool,names,(.2,.2,.2,.1,.1,.1,.1),meta)
    assert f[0][0]>0 and f[1][0]>0 and f[2][0]>0 and f[5][0]>0
    assert f[0][1:4]==(0.,0.,0.) and f[3][:6]==(0.,)*6 and f[4][:6]==(0.,)*6
    assert c['unresolved_spell_costs']==1 and c['recovered_costs']==6
    # Hybrid-only priors are not evidence of commitment to either color.
    f,_=extract(('hybrid',)*6,('u','b'),(.5,.5),meta)
    assert f[0][:6]==(0.,)*6 and f[1][:6]==(0.,)*6
    print('Mana parser contracts passed: symbols, alternative routes, faces, mechanics, colorless/snow and simple-cost parity.')

if __name__=='__main__':self_test()
