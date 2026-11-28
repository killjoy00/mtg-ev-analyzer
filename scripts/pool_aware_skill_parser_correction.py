"""Apply the fixed elite-context candidate with improved printed mana parsing."""
from __future__ import annotations
from pool_aware_refit import Choice
from pool_aware_skill_cost_neutral import parameters
import pool_aware_skill_contrast as skill
import pool_aware_mana_parser_v2 as parser

PROTOCOL='skill-contrast-elite-context-mana-parser-v2'
COLOR=(0,1,2,3,5)

def corrections(names,features,metadata,context,cards):
    rules=parser.index(metadata)
    statuses=[rules.get(n).status for n in names]
    color=[sum(f[i]*context[i] for i in COLOR) for f in features]
    readable=[v for v,s in zip(color,statuses) if s=='readable']
    average=sum(readable)/len(readable) if readable else 0.
    raw=[]
    for n,f,c,s in zip(names,features,color,statuses):
        value=sum(a*b for a,b in zip(f[:6],context))
        if s=='unreadable':value+=average-c
        raw.append(value+cards.get(n,0.))
    center=sum(raw)/len(raw)
    return tuple(max(-skill.MAX_LOG_ADJUST,min(skill.MAX_LOG_ADJUST,skill.LAMBDA*(x-center))) for x in raw),statuses

def apply(row,pool,metadata,context,cards):
    features,_=parser.extract(pool,row.candidates,row.support,metadata)
    delta,_=corrections(row.candidates,features,metadata,context,cards)
    # Retain original six feature slots solely for IDENTICAL historical audit
    # proxy membership. New parser features generate the adjustment, not a
    # new feature fit. Separate coverage is reported using the new parser.
    return Choice(row.source,row.event_time,row.candidates,row.support,
        tuple(f[:6]+(d,0.) for f,d in zip(row.features,delta)),row.chosen)

def predict_pairs(records,metadata,context,cards):
    rules=parser.index(metadata)
    return [(apply(r,p,rules,context,cards),p,k) for r,p,k in records]

def self_test():
    parser.self_test()
    from pool_aware_features import extract
    def c(cost,text=''):
        return dict(id=cost,layout='normal',mana_cost=cost,type_line='Creature',oracle_text=text)
    m={'u':c('{U}'),'h':c('{U/R}'),'cycling':c('{2}{U}','Cycling {2}'),'off':c('{R}{R}'),'unknown':None}
    pool=('u',)*6; names=('u','h','cycling','off','unknown');q=(.2,)*5
    f,_=extract(pool,names,q,m)
    row=Choice('test','2026-01-01T00:00:00Z',names,q,f,0)
    context=(.6,-.2,-.1,-.1,.2,-.3)
    new=apply(row,pool,parser.index(m),context,{})
    assert new.features[0][6]==new.features[1][6]==new.features[2][6]
    assert new.features[0][6]>new.features[3][6]
    assert new.features[0][6]>new.features[4][6]>new.features[3][6]
    assert all(a[:6]==b[:6] for a,b in zip(row.features,new.features))
    assert max(abs(f[6]) for f in new.features)<=skill.MAX_LOG_ADJUST
    print('Parser-adjusted scoring contracts passed: hybrid, cycling, neutral unknown and matched audit groups.')
