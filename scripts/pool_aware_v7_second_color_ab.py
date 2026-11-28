"""Triggered A+B, isolated from the validated incumbent parser and scorer.

This is the single owner-predeclared feature definition, not a feature search.
Use seven fitted context terms; slot 7 (zero-index 6) is established_support
only in fitting rows. Historical scoring rows retain the original audit
features and put the already-clipped delta in that slot, as before.
"""
from collections import Counter
import math
from pool_aware_refit import Choice, FEATURES
import pool_aware_mana_final as mana
import pool_aware_mana_parser_v2 as v2
import pool_aware_skill_contrast as skill

COLORS,SYMBOLS=mana.COLORS,mana.SYMBOLS
index=mana.index
source_counts=mana.source_counts
confidence=mana.confidence
CONTEXT_FEATURES=tuple(FEATURES[:6])+('established_support',)
COLOR=(0,1,2,3,5,6)
FEATURE_PROTOCOL='v7-second-color-A-B-v1'

def weighted_evidence(prior,demand):
    """One contribution/card/color; recognized routes with old prerequisites.

    B halves mandatory colored evidence from an off-main multicolor spell.
    A source-only route counts once at positive recognized strength.
    No unique primary => no B. C/S are not colored evidence.
    """
    reqs=[set(v2.requirements(card.mandatory)) & set(COLORS) for card in prior]
    rank=Counter(c for req in reqs for c in req).most_common()
    main=rank[0][0] if rank and (len(rank)==1 or rank[0][1]>rank[1][1]) else None
    direct_rows=[mana.per_card_evidence(c,lambda c,n:0.,land_only=True) for c in prior]
    direct=Counter()
    for row in direct_rows:direct.update(row)
    counts=Counter()
    for card,req,own in zip(prior,reqs,direct_rows):
        def base(c,n):
            if c in COLORS and demand[c]-int(c in req)>0:return 1.
            other=max(0.,direct[c]-own.get(c,0.))
            return other/(other+n) if other else 0.
        sources=mana.per_card_evidence(card,base)
        weight=.5 if main and len(req)>1 and main not in req else 1.
        for c in req | {c for c in COLORS if sources.get(c,0.)>0}:
            counts[c]+=weight if c in req else 1.
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
    k=weighted_evidence(prior,demand)
    def support_access(c,n):
        # B changes the supported-pip term only where an existing colored
        # demand pip is supported by less than one effective card. Preserve
        # the existing fractional access for source-only colors and C/S.
        if c in COLORS and demand[c]:
            return min(1.,k[c])
        return access(c,n)
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
        supported=single=multiple=multi=utility=cost=established=0.
        req={c:n for c,n in zip(SYMBOLS,r or ()) if n}
        if req:
            needed=sum(req.values())
            unmet={c:1-access(c,n) for c,n in req.items() if c in COLORS}
            supported=strength*sum(n*support_access(c,n) for c,n in req.items())/needed
            colored=sum(n for c,n in req.items() if c in COLORS)
            if card.status=='readable' and colored:
                established=strength*sum(n for c,n in req.items() if c in COLORS and k[c]>=2)/colored
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
        rows.append((supported,single,multiple,multi,utility,cost,established,0.))
    return tuple(rows),{'unknown_candidates':sum(c.layout=='missing' for c in available),
        'unresolved_spell_costs':sum(c.status=='unreadable' for c in available),
        'unknown_prior':sum(c.status=='unreadable' for c in prior),
        'recovered_costs':sum(c.previous_status=='unreadable' and c.status=='readable' for c in available),
        'recognized_source_candidates':sum(bool(c.sources) for c in available)}


def neutralize(names,features,metadata):
    rules=index(metadata)
    statuses=[rules.get(n).status for n in names]
    readable=[f for f,s in zip(features,statuses) if s=='readable']
    avg={i:sum(f[i] for f in readable)/len(readable) if readable else 0. for i in COLOR}
    return tuple(tuple(avg[i] if s=='unreadable' and i in COLOR else v for i,v in enumerate(f))
                 for f,s in zip(features,statuses)),statuses

def fit_features(row,pool,metadata):
    f,_=extract(pool,row.candidates,row.support,metadata)
    f,_=neutralize(row.candidates,f,metadata)
    return Choice(row.source,row.event_time,row.candidates,row.support,f,row.chosen)

def apply(row,pool,metadata,context,cards):
    if len(context)!=len(CONTEXT_FEATURES):raise ValueError('A+B context width')
    f=fit_features(row,pool,metadata).features
    raw=[sum(a*b for a,b in zip(x[:7],context))+cards.get(n,0.) for n,x in zip(row.candidates,f)]
    delta=mana.bounded([skill.LAMBDA*x for x in raw])
    return Choice(row.source,row.event_time,row.candidates,row.support,
                  tuple(x[:6]+(d,0.) for x,d in zip(row.features,delta)),row.chosen)

def self_test():
    def c(cost,typ='Creature',text=''):
        return dict(id=cost,layout='normal',mana_cost=cost,type_line=typ,oracle_text=text)
    rules=index({'w':c('{W}'),'u':c('{U}'),'ub':c('{U}{B}'),'wu':c('{W}{U}'),
                 'uu':c('{U}{U}'),'r':c('{R}'),'land':c('','Land','{T}: Add {U}.'),
                 'dual':c('{U}{B}','Creature','{T}: Add {U}.'),'missing':None})
    names=('w','u','uu','missing','land');q=(.2,)*5
    def x(pool):
        return extract(pool,names,q,rules)[0]
    def k(pool):
        prior=[rules.get(n) for n in pool]
        return weighted_evidence(prior,Counter(c for card in prior for c in v2.requirements(card.mandatory)))
    white=('w',)*5
    assert k(white+('ub',))['U']==.5
    assert k(white+('wu',))['U']==1.
    assert k(white+('u','u'))['U']==2.
    assert k(white+('u',))['U']==1.
    assert k(('w','u','ub'))['U']==2. # unique U, no off-main B
    assert k(('w','u','r','ub'))['U']==2.
    assert k(('w','w','u','u','ub'))['U']==3. # unique U
    assert k(('w','u','ub','w'))['U']==2. # tied W/U => no B
    assert k(white+('dual',))['U']==.5 # same card/source cannot double count
    assert k(white+('land',))['U']==1.
    assert math.isclose(x(white+('ub',))[1][0],.5*x(white+('ub',))[0][0])
    assert x(white+('wu',))[1][0]==x(white+('wu',))[0][0]
    assert x(white+('u','u'))[1][6]>0
    assert x(white+('u',))[1][6]==0
    assert x(white+('u','u'))[0][6]>0 # main colored pips remain included
    raw=x(white+('u','u'))
    assert raw[3][6]==raw[4][6]==0.
    neutral,status=neutralize(names,raw,rules)
    assert math.isclose(neutral[3][6],sum(raw[i][6] for i in (0,1,2))/3)
    assert neutral[4][6]==0.
    incumbent=mana.extract(white,names,q,rules)[0]
    assert all(a[:6]==b[:6] for a,b in zip(incumbent,x(white)))
    row=Choice('fixture','2026-01-01T00:00:00Z',names,q,incumbent,0)
    beta=(.2,-.2,-.3,-.4,.1,-.5,.6)
    fit=fit_features(row,white+('u','u'),rules)
    got=apply(row,white+('u','u'),rules,beta,{})
    expected=mana.bounded([skill.LAMBDA*sum(a*b for a,b in zip(f[:7],beta)) for f in fit.features])
    assert tuple(f[6] for f in got.features)==expected
    assert max(abs(f[6]) for f in got.features)<=mana.HALF_SPAN
    assert all(a[:6]==b[:6] for a,b in zip(row.features,got.features))
    print('A+B contracts: fixed weights, established depth, tie, source deduplication, unreadable imputation, original audit slots, exact clipping.')
