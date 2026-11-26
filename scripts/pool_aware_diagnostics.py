"""Aggregate paired development diagnostics. Historical choices are not trophies
or correctness labels. No row-level data, identifiers or card names are exported.
"""
from collections import defaultdict
import math

from pool_aware_refit import FEATURES, Choice, weights

ZERO=(0.,)*len(FEATURES)


def interval(clusters):
    """Draft-cluster robust normal interval for a decision-weighted mean.
    Descriptive development interval: model selection used the same validation.
    """
    n=sum(v[0] for v in clusters.values())
    g=len(clusters)
    if not n:
        return None
    delta=sum(v[1] for v in clusters.values())/n
    if g<2:
        return {'decisions':n,'drafts':g,'delta':delta,'ci95':None}
    se=math.sqrt(g/(g-1)*sum((s-delta*k)**2 for k,s in clusters.values()))/n
    return {'decisions':n,'drafts':g,'delta':delta,'ci95':[delta-1.96*se,delta+1.96*se]}


def grade(p):
    """Model-only ratio: no historical-choice 100-point override."""
    lead=max(p)
    return [min(95,math.floor(95*x/lead+.5)) for x in p]


def leader(row,p):
    return min(range(len(p)),key=lambda i:(-p[i],row.candidates[i]))


def diagnostics(records,beta,placebo_rows=(),placebo_beta=ZERO):
    # Use source draft as the cluster; keep IDs in memory only.
    predictions=defaultdict(lambda:defaultdict(lambda:[0,0.,0.]))
    transitions=defaultdict(lambda:[0,0,0,0,0,0,0])
    shuffled={(r.source,r.event_time,r.candidates,r.chosen):r for r in placebo_rows}
    matched=defaultdict(lambda:[0,0.])
    for row,_,pick in records:
        p,q=weights(row,ZERO),weights(row,beta)
        delta=math.log(max(p[row.chosen],1e-300))-math.log(max(q[row.chosen],1e-300))
        top=(leader(row,q)==row.chosen)-(leader(row,p)==row.chosen)
        stage='p1p1_4' if pick<=4 else 'p1p5_8' if pick<=8 else 'p1p9_11'
        for group in ('all',stage):
            cluster=predictions[group][row.source]
            cluster[0]+=1;cluster[1]+=delta;cluster[2]+=top
        s=shuffled.get((row.source,row.event_time,row.candidates,row.chosen))
        if s is not None:
            z=weights(s,placebo_beta)
            x=matched[row.source]
            x[0]+=1;x[1]+=math.log(max(z[row.chosen],1e-300))-math.log(max(q[row.chosen],1e-300))
        a,b=grade(p),grade(q)
        for i,f in enumerate(row.features):
            if i==row.chosen:
                continue
            # Feature-defined proxies, not independently adjudicated decisions.
            groups=['all_alternatives',stage]
            if f[1]+f[2]+f[3]>=.15:
                groups.append('missing_access_proxy')
            if f[0]>=.15 and f[1]+f[2]+f[3]==0:
                groups.append('supported_proxy')
            if f[4]>0:
                groups.append('fixing_proxy')
            if a[i]>=90:
                groups.append('baseline_close_proxy')
            for group in groups:
                v=transitions[group]
                v[0]+=1;v[1]+=b[i]-a[i];v[2]+=abs(b[i]-a[i])
                v[3]+=a[i]>=90;v[4]+=b[i]>=90
                v[5]+=a[i]>=40 and b[i]<40
                v[6]+=a[i]<75 and b[i]>=75
    return {
        'scope':'development_validation_selected_model; descriptive intervals, not confirmatory',
        'paired':{g:{'raw_log_loss':interval({d:(v[0],v[1]) for d,v in c.items()}),
                      'top1':interval({d:(v[0],v[2]) for d,v in c.items()})}
                  for g,c in predictions.items()},
        'real_minus_shuffled_raw_log_loss':interval(matched),
        'alternative_transitions':{g:{'alternatives':v[0],'mean_change':v[1]/v[0],
            'mean_absolute_change':v[2]/v[0],'baseline_90_95':v[3],'challenger_90_95':v[4],
            'crossed_below_40':v[5],'crossed_up_to_75':v[6]}
            for g,v in transitions.items()},
        'note':'Model-only scores exclude historical chosen card; no trophy/quality labels. Overlapping proxy groups. Negative log-loss delta favors real context.'}


def self_test():
    a=Choice('a','2025-01-01T00:00:00Z',('x','y'),(.6,.4),
             ((0.,)*8,(1.,)+(0.,)*7),1)
    b=Choice('b','2025-01-02T00:00:00Z',('x','y'),(.6,.4),
             ((0.,)*8,(1.,)+(0.,)*7),1)
    r=diagnostics([(a,(),5),(b,(),5)],(1.,)+(0.,)*7,[a,b],ZERO)
    assert r['paired']['all']['raw_log_loss']['delta']<0
    assert r['paired']['all']['top1']['delta']==1
    assert r['real_minus_shuffled_raw_log_loss']['delta']<0
    assert r['alternative_transitions']['all_alternatives']['alternatives']==2
    assert grade((.6,.4))==[95,63]
    assert interval({'a':[1,0.]})['ci95'] is None
    print('Aggregate paired diagnostic contracts passed.')


if __name__=='__main__':
    self_test()
