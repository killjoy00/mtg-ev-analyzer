"""Final v7 mana-context features: explicit source routes and bounded clipping.

A route is evidence of a possible source, not a mana-base simulation.
Keep the validated v2 parser and earlier research lock unchanged.
"""
from __future__ import annotations
from collections import Counter
from dataclasses import dataclass
import math
import re
from dataclasses import replace

import pool_aware_mana_parser_v2 as v2

COLORS=v2.COLORS
TYPES=dict(zip(('Plains','Island','Swamp','Mountain','Forest'),COLORS))
SYMBOLS=v2.SYMBOLS
# Exact, unrestricted production and basic/type search text. Do not infer
# mana from arbitrary oracle mentions, color identity or produced_mana alone.
DIRECT=re.compile(r'^\{T\}: Add ((?:\{[WUBRGC]\})(?:(?:, | or |, or )\{[WUBRGC]\})*)\.$')
ANY=re.compile(r'^\{T\}: Add one mana of any color\.$',re.I)
FETCH=re.compile(r'^\{T\}(?:, Pay [1-9][0-9]* life)?, Sacrifice (?:this land|[^:]+): Search your library for (?:a |an )?(.+?) card, (?:reveal it, )?put (?:it|that card) (?:onto the battlefield(?: tapped)?|into your hand), then shuffle\.(?: (?:If you control four or more lands, untap that land\.|If you control four or more lands, untap it\.))?$',re.I)
LANDCYCLE=re.compile(r'(?im)^\s*(Basic land|Plains|Island|Swamp|Mountain|Forest)cycling ((?:\{[^{}]+\})+)(?:\s|$)')
TOKEN=v2.TOKEN
MAX_PAIR_RATIO=1.25
MAX_SPAN=math.log(MAX_PAIR_RATIO)
HALF_SPAN=MAX_SPAN/2
FRONT_LAYOUTS=v2.FRONT_LAYOUTS|{'prepare','reversible_card'}

@dataclass(frozen=True)
class Route:
    colors: frozenset[str]
    weight: float
    cost_routes: tuple[tuple[int,...],...]
    kind: str

@dataclass(frozen=True)
class Card:
    parsed: v2.Card
    sources: tuple[Route,...]
    def __getattr__(self,key):
        return getattr(self.parsed,key)

def search_colors(target):
    if target.lower()=='basic land':
        # Wastes/snow basics cannot be assumed legal/available in a draft.
        return frozenset(COLORS)
    names=re.split(r', or |, | or ',target)
    if names and all(n in TYPES for n in names):
        return frozenset(TYPES[n] for n in names)
    return frozenset()

def face_routes(face,land,spell_routes):
    text=face.get('oracle_text') or ''
    if not isinstance(text,str):
        return []
    result=[]
    line=str(face.get('type_line') or '')
    printed_types=line.split(' — ')[0].split()
    direct=set()
    if land:
        direct.update(TYPES[t] for t in line.partition(' — ')[2].split() if t in TYPES)
    # Conditional "Spend this mana only..." in the SAME ability is not
    # unrestricted. A different independent ability on another line is fine.
    for part in text.splitlines():
        m=DIRECT.fullmatch(part.strip())
        if m:
            direct.update(TOKEN.findall(m[1]))
        elif ANY.fullmatch(part.strip()):
            direct.update(COLORS)
        if land:
            fetch=FETCH.fullmatch(part.strip())
            if fetch:
                cs=search_colors(fetch[1])
                if cs:
                    result.append(Route(cs,1.,(),'typed_or_basic_fetch'))
    # Artifact/creature mana sources must be cast first; no self-bootstrap.
    if direct and (land or (spell_routes and any(t in printed_types for t in ('Artifact','Creature','Enchantment')))):
        if 'Snow' in printed_types:
            direct.add('S')
        result.append(Route(frozenset(direct),1. if land else .5,() if land else spell_routes,
                            'direct_land' if land else 'castable_mana_source'))
    for m in LANDCYCLE.finditer(text):
        cost=v2.parse_cost(m[2])
        if cost:
            cs=frozenset(COLORS) if m[1].lower()=='basic land' else frozenset((TYPES[m[1].title()],))
            result.append(Route(cs,.5,cost.routes,'landcycling'))
    return result

def parse_card(raw):
    # Both layouts have an explicit hand-cast front. Prepared copies are
    # not hand-cast spells; reversible faces represent the same card.
    if isinstance(raw,dict) and raw.get('layout') in ('prepare','reversible_card'):
        layout=raw['layout']
        if raw.get('card_faces'):
            parsed=v2.parse_card(dict(raw,layout='transform'))
        else:
            parsed=v2.parse_card(raw)
        return replace(parsed,layout=layout,previous_status=v2.previous_status(raw))
    return v2.parse_card(raw)


def source_routes(raw,parsed):
    if not isinstance(raw,dict):
        return ()
    faces=raw.get('card_faces')
    if isinstance(faces,list) and faces and all(isinstance(x,dict) for x in faces):
        if parsed.layout in FRONT_LAYOUTS:
            faces=faces[:1]
        elif parsed.layout not in v2.CHOICE_LAYOUTS:
            return ()
    else:
        faces=[raw]
    result=[]
    for face in faces:
        land=v2.is_land(face)
        cost=v2.parse_cost(face.get('mana_cost'))
        result.extend(face_routes(face,land,cost.routes if cost else ()))
    return tuple(result)

class RulesIndex:
    def __init__(self,metadata):
        self.cards={}
        for name,raw in metadata.items():
            p=parse_card(raw)
            self.cards[name]=Card(p,source_routes(raw,p))
        self.missing=Card(v2.parse_card(None),())
    def get(self,name):
        return self.cards.get(name,self.missing)

def index(metadata):
    return metadata if isinstance(metadata,RulesIndex) else RulesIndex(metadata)

def confidence(route,base):
    if not route.cost_routes:
        return 1.
    return max(min((base(c,n) for c,n in zip(SYMBOLS,r) if n),default=1.) for r in route.cost_routes)

def per_card_evidence(card,base,land_only=False):
    # One card cannot produce multiple independent sources through mutually
    # exclusive modes. The base callback never includes its own evidence.
    best={}
    for r in card.sources:
        if land_only and r.cost_routes:
            continue
        strength=r.weight*confidence(r,base)
        for c in r.colors:
            best[c]=max(best.get(c,0.),strength)
    return best


def source_counts(prior,demand):
    direct_rows=[per_card_evidence(c,lambda c,n:0.,land_only=True) for c in prior]
    direct=Counter()
    for r in direct_rows:
        direct.update(r)
    counts=Counter()
    for card,own in zip(prior,direct_rows):
        mandatory=set(v2.requirements(card.mandatory))
        def base(c,n):
            # A mana creature cannot use its own pip as evidence of a lane;
            # also exclude its optional land face from its cast prerequisite.
            if c in COLORS and demand[c]-int(c in mandatory)>0:
                return 1.
            other=max(0.,direct[c]-own.get(c,0.))
            return other/(other+n) if other else 0.
        counts.update(per_card_evidence(card,base))
    return counts


def extract(pool,candidates,support,metadata,interactions=()):
    if interactions:
        raise ValueError('no new synergy features')
    if len(candidates)!=len(support) or not candidates or len(set(candidates))!=len(candidates):
        raise ValueError('invalid candidate alignment')
    if any(p<=0 or not math.isfinite(p) for p in support):
        raise ValueError('invalid raw support')
    rules=index(metadata)
    prior=[rules.get(n) for n in pool]; available=[rules.get(n) for n in candidates]
    pips=[v2.requirements(c.mandatory) for c in prior if any(c.mandatory)]
    demand=Counter(c for p in pips for c in p)
    # Direct and fetch land evidence first. Nonland routes may depend on
    # those sources or on existing color demand, never on themselves.
    counts=source_counts(prior,demand)
    def access(c,n):
        # Existing drafted color remains incumbent lane evidence. A single
        # fixer does not make every off-color double-pip spell fully on-color.
        if c in COLORS and demand[c]:
            return 1.
        if c in 'CS':
            return counts[c]/(counts[c]+n) if counts[c] else 0.
        return counts[c]/(counts[c]+n) if counts[c] else 0.
    stage=min(1.,len(prior)/8.)
    commitment=min(1.,max(0.,(len(pips)-2)/4.))
    concentration=sum(demand[c] for c in COLORS if demand[c]>=2)/max(1,sum(demand.values()))
    coverage=sum(c.status=='readable' or bool(c.sources) for c in prior)/max(1,len(prior))
    strength=stage*commitment*concentration*coverage
    def route_key(r):
        # C/S feasibility is unknown without actual sources. For a hybrid
        # option with no C source, do not pretend C is a free colored route.
        return (sum(n*(1-access(c,n)) for c,n in zip(SYMBOLS,r) if n),
                sum(1-access(c,n) for c,n in zip(SYMBOLS,r) if n),
                r[7],r[8],r[9],r)
    routes=[min(c.routes,key=route_key) if c.routes else None for c in available]
    fits=[]
    for r in routes:
        req={c:n for c,n in zip(SYMBOLS,r or ()) if n}
        # No unearned on-color bonus for a generic or unobserved special cost.
        # Positive C/S evidence is meaningful; absence is not an off-color
        # judgment, since the format's basic/snow mana base is unobserved.
        fits.append(min((access(c,n) for c,n in req.items()),default=0.))
    leader=max(support); rows=[]
    for i,(card,r) in enumerate(zip(available,routes)):
        supported=single=multiple=multi=utility=cost=0.
        req={c:n for c,n in zip(SYMBOLS,r or ()) if n}
        if req:
            needed=sum(req.values())
            unmet={c:1-access(c,n) for c,n in req.items() if c in COLORS}
            supported=strength*sum(n*access(c,n) for c,n in req.items())/needed
            single=strength*sum(v for c,v in unmet.items() if req[c]==1)/max(1,len(req))
            multiple=strength*sum(req[c]*v for c,v in unmet.items() if req[c]>1)/needed
            multi=strength*max(0.,sum(unmet.values())-1)/max(1,len(req)-1)
            competing=max((s/leader*fits[j] for j,s in enumerate(support) if j!=i),default=0.)
            cost=competing*strength*sum(req[c]*v for c,v in unmet.items())/needed
        # Same existing fixing feature. Recognize marginal access to drafted
        # colors from new sources, with diminishing returns and prerequisites.
        if demand:
            best={}
            for source in card.sources:
                if len(source.colors&set(COLORS))<2:
                    continue
                feasible=confidence(source,access)
                for c in source.colors&set(COLORS):
                    best[c]=max(best.get(c,0.),source.weight*feasible)
            utility=stage*sum(demand[c]*v/(1+counts[c]) for c,v in best.items())/sum(demand.values())
        rows.append((supported,single,multiple,multi,utility,cost,0.,0.))
    return tuple(rows),{'unknown_candidates':sum(c.layout=='missing' for c in available),
        'unresolved_spell_costs':sum(c.status=='unreadable' for c in available),
        'unknown_prior':sum(c.status=='unreadable' for c in prior),
        'recovered_costs':sum(c.previous_status=='unreadable' and c.status=='readable' for c in available),
        'recognized_source_candidates':sum(bool(c.sources) for c in available)}

def bounded(deltas):
    # Predeclared independent centered clipping, not pack-spread scaling.
    # Centering is retained from the original recipe. An outlier can move
    # the center, but cannot scale the differences between other cards.
    if not deltas:return ()
    mean=sum(deltas)/len(deltas)
    return tuple(max(-HALF_SPAN,min(HALF_SPAN,d-mean)) for d in deltas)


def self_test():
    from pool_aware_diagnostics import grade
    import random
    def card(cost='',typ='Creature',text='',layout='normal',**kw):
        return dict(id='synthetic',layout=layout,type_line=typ,mana_cost=cost,oracle_text=text,**kw)
    m={'w':card('{W}'),'b':card('{B}'),'bb':card('{B}{B}'),'c':card('{C}'),
       'fetch':card('', 'Land','{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'),
       'typed':card('', 'Land','{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Swamp card, put it onto the battlefield, then shuffle.'),
       'csource':card('','Land','{T}: Add {C}.'),
       'snow':card('','Basic Snow Land — Island','{T}: Add {U}.'),
       'rock':card('{2}','Artifact','{T}: Add one mana of any color.'),
       'dork':card('{G}','Creature','{T}: Add one mana of any color.'),
       'cond':card('{2}','Artifact','{T}: Add one mana of any color. Spend this mana only to cast creature spells.'),
       'cycle':card('{4}{G}','Creature','Swampcycling {2}'),
       'dual':card('','Land — Plains Swamp','{T}: Add {W} or {B}.')}
    rules=index(m)
    assert rules.get('fetch').sources[0].colors==frozenset(COLORS)
    assert rules.get('typed').sources[0].colors==frozenset('WB')
    assert rules.get('csource').sources[0].colors==frozenset('C')
    assert rules.get('snow').sources[0].colors==frozenset('US')
    assert rules.get('rock').sources[0].weight==.5
    assert not rules.get('cond').sources
    front=card('{B}'); back=card('{R}{R}')
    prep=parse_card(card(layout='prepare',card_faces=[front,back]))
    assert prep.status=='readable' and prep.routes==v2.parse_cost('{B}').routes
    rev=parse_card(card(layout='reversible_card',card_faces=[m['dual'],m['dual']]))
    assert rev.status=='land' and len(source_routes(card(layout='reversible_card',card_faces=[m['dual'],m['dual']]),rev))==1
    assert source_counts([rules.get('dork')],Counter({'G':1}))['B']==0
    assert rules.get('cycle').sources[0].colors==frozenset('B')
    names=('w','b','bb','c','fetch','rock');p=(1/6,)*6
    prior=('w',)*6
    a,_=extract(prior,names,p,rules)
    b,_=extract(prior+('fetch',),names,p,rules)
    assert a[4][4]>0 and a[5][4]>0
    assert 0<b[1][0]<b[0][0] and b[2][0]<b[1][0]
    assert b[1][1]>0 and b[2][2]>0
    c,_=extract(prior+('csource',),names,p,rules)
    assert c[3][0]>0 and a[3][0]==0 and a[3][1:4]==(0.,0.,0.)
    d,_=extract(prior+('dork',),names,p,rules)
    assert d[1][0]==0 # cannot bootstrap green
    assert all(f==(0.,)*8 for f in extract((),names,p,rules)[0])
    # Ordinary no-fixing colored packs reproduce v2's feature arithmetic.
    assert extract(prior,('w','bb'),(.5,.5),rules)[0]==v2.extract(prior,('w','bb'),(.5,.5),m)[0]
    # Same mean, different extreme outliers: unclipped corrections do not shrink.
    a=bounded((-.02,.02,-1.,1.));b=bounded((-.02,.02,-10.,10.))
    assert a[:2]==b[:2] and a[2:]==b[2:]
    rng=random.Random(1863)
    for _ in range(2000):
        q=[rng.random() for _ in range(10)]
        delta=bounded([rng.uniform(-3,3) for _ in q])
        assert max(delta)-min(delta)<=MAX_SPAN+1e-12
        new=[x*math.exp(d) for x,d in zip(q,delta)]
        assert max(abs(x-y) for x,y in zip(grade(q),grade(new)))<=19
    print('Final mana-source contracts passed: fetches, direct C/S, landcycling, cast prerequisites, graded splash access and 19-point bound.')

if __name__=='__main__':self_test()
