"""Development-only comparison of fixing-aware feature variants.

The original six opportunity columns remain a reference. Columns 6/7 are
repurposed in this *separate* experiment, not interpreted as synergy.
All route/access values are bounded evidence features, not casting odds.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
import math
import re

from pool_aware_features import COLORS, TYPES, TOKEN, canonical, spell_pips, fixing_colors
from pool_aware_refit import Choice, weights, evaluate
from pool_aware_fast_fit import fit
from pool_aware_diagnostics import grade, interval, leader

PENALTIES=(.02,.1,.5)
ZERO=(0.,)*8
DIRECT=re.compile(r'\{T\}: Add (?:\{[WUBRG]\}(?:, | or |, or )?)+\.')
FETCH=re.compile(r'^\{T\}(?:, Pay 1 life)?, Sacrifice (?:this land|[^:]+): Search your library for (?:a |an )?(.+?) card, put (?:it|that card) onto the battlefield(?: tapped)?, then shuffle\.$',re.I)
ANY='Add one mana of any color.'
BASIC_CYCLE=re.compile(r'(?im)^Basic landcycling \{[12]\}(?:\s|$)')


@dataclass(frozen=True)
class Route:
    colors: frozenset
    kind: str
    evidence: float


def route(card):
    c=canonical(card)
    if not c:
        return None
    land='Land' in c['type_line'].split(' — ')[0].split()
    text=c['oracle_text']
    if BASIC_CYCLE.search(text):
        return Route(frozenset(COLORS),'basic_landcycling',.5)
    old=fixing_colors(c)
    if land:
        if old:
            return Route(old,'direct_land',1.)
        for line in text.splitlines():
            if line=='{T}: '+ANY:
                return Route(frozenset(COLORS),'direct_land',1.)
            m=FETCH.fullmatch(line)
            if m:
                target=m.group(1)
                if target.lower()=='basic land':
                    return Route(frozenset(COLORS),'fetch_basic',1.)
                # Only a list of named basic land types; no restrictions or
                # assumptions about drafting nonbasic fetch targets.
                names=re.split(r', | or |, or ',target)
                if names and all(n in TYPES for n in names):
                    return Route(frozenset(TYPES[n] for n in names),'fetch_typed',1.)
    elif spell_pips(c) is not None and any(t in c['type_line'].split(' — ')[0].split() for t in ('Artifact','Creature')):
        produced=set(c.get('produced_mana') or ()) & set(COLORS)
        for line in text.splitlines():
            if line=='{T}: '+ANY:
                return Route(frozenset(COLORS),'castable_mana_source',.5)
            if DIRECT.fullmatch(line):
                cs=frozenset(set(TOKEN.findall(line)) & produced)
                if cs:
                    return Route(cs,'castable_mana_source',.5)
    return None


class Context:
    def __init__(self,metadata):
        self.pips={n:spell_pips(c) for n,c in metadata.items()}
        self.routes={n:route(c) for n,c in metadata.items()}
        self.canonical={n:canonical(c) for n,c in metadata.items()}

    def describe(self,row,pool):
        pips=[self.pips.get(n) for n in pool]
        known=[p for p in pips if p]
        demand=Counter(c for p in known for c in p)
        count=Counter()
        for n in pool:
            r=self.routes.get(n)
            if r and r.kind!='castable_mana_source':
                for c in r.colors:
                    count[c]+=r.evidence

        def access(c,n):
            if demand[c]>=2:
                return 1.
            return max(.5 if demand[c] else 0.,count[c]/(count[c]+n))

        # Mana creatures/rocks need a castable printed spell cost first.
        # Do not allow mana rocks to bootstrap each other or themselves.
        castable=[]
        for n in pool:
            r=self.routes.get(n)
            req=self.pips.get(n)
            if r and r.kind=='castable_mana_source' and req is not None:
                feasibility=min((access(c,k) for c,k in req.items()),default=1.)
                castable.append((r,feasibility))
        for r,feasibility in castable:
            for c in r.colors:
                count[c]+=r.evidence*feasibility
        stage=min(1.,len(pool)/8.)
        commitment=min(1.,max(0.,(len(known)-2)/4.))
        concentration=sum(v for v in demand.values() if v>=2)/max(1,sum(demand.values()))
        coverage=sum(p is not None or self.routes.get(n) is not None for n,p in zip(pool,pips))/max(1,len(pool))
        strength=stage*commitment*concentration*coverage
        lead=max(row.support)
        requirements=[self.pips.get(n) for n in row.candidates]
        best_access=[]
        for req in requirements:
            best_access.append(min((access(c,k) for c,k in req.items()),default=0.) if req else 0.)
        additive=[]
        graded=[]
        groups=[]
        for i,(name,req,f) in enumerate(zip(row.candidates,requirements,row.features)):
            r=self.routes.get(name)
            bridge=optionality=0.
            tags=[]
            if r and len(r.colors)>=2:
                tags.extend(('recognized_fixer','route_'+r.kind))
                if f[4]>0:
                    tags.append('old_fixing_proxy')
                if r.kind=='castable_mana_source':
                    feasibility=min((access(c,k) for c,k in (req or {}).items()),default=1.) if req is not None else 0.
                else:
                    feasibility=1.
                # Diversification and incremental coverage, with diminishing
                # returns for redundant sources. No benefit before any pick.
                bridge=stage*r.evidence*feasibility*sum(demand[c]/(1+count[c]) for c in r.colors)/max(1,sum(demand.values()))
                new=sum((1-access(c,1))/(1+count[c]) for c in r.colors)/len(COLORS)
                optionality=stage*r.evidence*feasibility*new
            if req and len(req)==1:
                c,k=next(iter(req.items()))
                if k==1 and not demand[c] and count[c]>0:
                    tags.append('single_pip_splash_proxy')
                if k>1 and not demand[c]:
                    tags.append('off_lane_multi_pip_proxy')
            if f[1]+f[2]+f[3]>=.15:
                tags.append('old_missing_access_proxy')
            if f[0]>=.15 and f[1]+f[2]+f[3]==0:
                tags.append('old_supported_proxy')
            additive.append(tuple(f[:6])+(bridge,optionality))
            if req:
                total=sum(req.values())
                unmet={c:1-access(c,k) for c,k in req.items()}
                supported=strength*sum(k*(1-unmet[c]) for c,k in req.items())/total
                single=strength*sum(unmet[c] for c,k in req.items() if k==1)/len(req)
                multiple=strength*sum(k*unmet[c] for c,k in req.items() if k>1)/total
                multi=strength*max(0.,sum(unmet.values())-1)/max(1,len(req)-1)
                competing=max((s/lead*best_access[j] for j,s in enumerate(row.support) if j!=i),default=0.)
                cost=competing*strength*sum(k*unmet[c] for c,k in req.items())/total
                graded.append((supported,single,multiple,multi,f[4],cost,bridge,optionality))
            else:
                graded.append(tuple(f[:6])+(bridge,optionality))
            groups.append(tuple(tags))
        return tuple(additive),tuple(graded),tuple(groups)


def convert(records,ctx,variant):
    result=[]
    for row,pool,pick in records:
        a,b,_=ctx.describe(row,pool)
        result.append(Choice(row.source,row.event_time,row.candidates,row.support,a if variant=='additive_routes' else b,row.chosen))
    return result


def compare(records,new,beta_old,beta_new,ctx):
    if len(records)!=len(new):
        raise ValueError('unaligned comparison')
    transitions=defaultdict(lambda:[0,0.,0.,0.,0,0,0,0,0,0,0,0])
    prediction=defaultdict(lambda:defaultdict(lambda:[0,0.,0.]))
    for (row,pool,pick),candidate in zip(records,new):
        if (row.source,row.event_time,row.candidates,row.chosen)!=(candidate.source,candidate.event_time,candidate.candidates,candidate.chosen):
            raise ValueError('row alignment mismatch')
        p,q,z=weights(row,ZERO),weights(row,beta_old),weights(candidate,beta_new)
        a,b,c=grade(p),grade(q),grade(z)
        _,_,groups=ctx.describe(row,pool)
        stage='early_p1p1_4' if pick<=4 else 'middle_p1p5_8' if pick<=8 else 'late_p1p9_11'
        has_fixer=any('recognized_fixer' in g for g in groups)
        for g in ('all',stage,'pack_has_recognized_fixer' if has_fixer else 'pack_no_recognized_fixer'):
            v=prediction[g][row.source]
            v[0]+=1
            v[1]+=math.log(max(q[row.chosen],1e-300))-math.log(max(z[row.chosen],1e-300))
            v[2]+=(leader(row,z)==row.chosen)-(leader(row,q)==row.chosen)
        for i,tags in enumerate(groups):
            if i==row.chosen:
                continue
            old_shift=sum(x*y for x,y in zip(row.features[i],beta_old))
            for g in ('all_alternatives',stage,*tags):
                v=transitions[g]
                v[0]+=1
                v[1]+=b[i]-a[i];v[2]+=c[i]-a[i];v[3]+=c[i]-b[i]
                v[4]+=a[i]>=90;v[5]+=b[i]>=90;v[6]+=c[i]>=90
                v[7]+=a[i]>=40 and b[i]<40;v[8]+=a[i]>=40 and c[i]<40
                v[9]+=b[i]>=40 and c[i]<40;v[10]+=b[i]<40 and c[i]>=40
                v[11]+=b[i]<a[i] and old_shift>=0.
    return {'relative_to_opportunity':{g:{'raw_log_loss':interval({d:(v[0],v[1]) for d,v in x.items()}),
               'top1':interval({d:(v[0],v[2]) for d,v in x.items()})} for g,x in prediction.items()},
            'transitions':{g:{'alternatives':v[0],'opportunity_mean_delta_vs_v6':v[1]/v[0],
              'challenger_mean_delta_vs_v6':v[2]/v[0],'challenger_mean_delta_vs_opportunity':v[3]/v[0],
              'v6_90_95':v[4],'opportunity_90_95':v[5],'challenger_90_95':v[6],
              'opportunity_crossed_below_40_vs_v6':v[7],'challenger_crossed_below_40_vs_v6':v[8],
              'challenger_crossed_below_40_vs_opportunity':v[9],'challenger_rescued_to_40':v[10],
              'opportunity_grade_decreased_despite_nonnegative_raw_shift':v[11]}
              for g,v in transitions.items()},
            'scope':'historical behavior and overlapping feature proxies; not independent decision quality'}


def study(partitions,metadata,old):
    ctx=Context(metadata)
    beta=tuple(old['beta'])
    train,validation,ordinary=[partitions[k][0] for k in ('residual','validation','ordinary_validation')]
    report={'reference':'opportunity','reference_beta':beta,'reference_validation':old['validation'],
            'reference_ordinary':old.get('ordinary_validation'),'variants':{},
            'feature_schema':{'additive_routes':['original opportunity columns 0–5','marginal_bridge','optionality'],
              'graded_access':['graded support','graded single-pip deficit','graded multi-pip deficit','graded multicolor deficit','original fixing utility','graded opportunity cost','marginal_bridge','optionality']},
            'route_values_are_probabilities':False}
    for variant in ('additive_routes','graded_access'):
        tr=convert(train,ctx,variant)
        va=convert(validation,ctx,variant)
        fits=[]
        for p in PENALTIES:
            b,opt=fit(tr,'combined',p,max_iter=1000,tol=1e-6)
            if opt['converged']:
                m=evaluate(va,b)
                fits.append((m['raw_log_loss'],-p,b,opt,m))
        if not fits:
            raise RuntimeError('no converged '+variant)
        _,neg,b,opt,m=min(fits,key=lambda x:x[:2])
        del tr
        r={'beta':b,'penalty':-neg,'optimizer':opt,'validation':m,
           'paired_diagnostics':compare(validation,va,beta,b,ctx)}
        del va
        if ordinary:
            oo=convert(ordinary,ctx,variant)
            r['ordinary_validation']=evaluate(oo,b)
            r['ordinary_paired_diagnostics']=compare(ordinary,oo,beta,b,ctx)
        report['variants'][variant]=r
    return report


def self_test():
    def card(n,cost='',typ='Creature',text='',produced=()):
        return dict(id=n,layout='normal',mana_cost=cost,type_line=typ,oracle_text=text,produced_mana=list(produced))
    m={'w':card('w','{W}'),'ww':card('ww','{W}{W}'),
       'b':card('b','{B}'),'bb':card('bb','{B}{B}'),
       'dual':card('dual',typ='Land — Plains Swamp',produced=('W','B')),
       'fetch':card('fetch',typ='Land',text='{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'),
       'rock':card('rock','{2}',typ='Artifact',text='{T}: Add one mana of any color.'),
       'cond':card('cond','{G}',text='{T}: Add one mana of any color. Spend this mana only to cast creature spells.')}
    assert route(m['fetch']).kind=='fetch_basic'
    assert route(m['rock']).kind=='castable_mana_source'
    assert route(m['cond']) is None
    from pool_aware_features import extract
    pool=('w','w','ww','w','ww','dual')
    candidates=('b','bb','fetch','rock','cond','w')
    supports=(.1,)*len(candidates)
    f,_=extract(pool,candidates,supports,m)
    row=Choice('a','2025-01-01T00:00:00Z',candidates,supports,f,0)
    a,b,g=Context(m).describe(row,pool)
    assert all(x[:6]==y[:6] for x,y in zip(a,f))
    assert b[0][1]>0 and b[1][2]>0
    assert b[2][6]>0 and b[3][7]>0 and b[4][6:]==(0.,0.)
    assert 'single_pip_splash_proxy' in g[0] and 'off_lane_multi_pip_proxy' in g[1]
    e,_=extract((),candidates,supports,m)
    early=Choice('e','2025-01-01T00:00:00Z',candidates,supports,e,0)
    a,b,_=Context(m).describe(early,())
    assert all(x==(0.,)*8 for x in a+b)
    print('Fixing route and graded-access contracts passed.')


if __name__=='__main__':
    self_test()
