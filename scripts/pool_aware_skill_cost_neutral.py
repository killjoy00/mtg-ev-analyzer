"""Frozen v7 neutral-cost correction. Research and shadow audit only.

Impute only the color-fit term, never the card effect or known fixing term.
No refit, mana parsing expansion, parameter search, or serving write.
"""
from __future__ import annotations
import math
from pool_aware_features import spell_pips
from pool_aware_refit import Choice
import pool_aware_skill_contrast as skill

PROTOCOL='skill-contrast-elite-context-neutral-cost-v1'
COLOR=(0,1,2,3,5)

def land_only(card):
    if not isinstance(card,dict):
        return False
    faces=card.get('card_faces') or [card]
    return all('Land' in str(f.get('type_line','')).split(' — ')[0].split() for f in faces)

def cost_status(card):
    if land_only(card):
        return 'land'
    return 'readable' if spell_pips(card) is not None else 'unreadable'

def parameters(fit):
    if set(fit['elite_card_effects'])!=set(fit['control_card_effects']):
        raise ValueError('frozen card coefficient mismatch')
    if (fit['lambda']!=skill.LAMBDA or fit['max_log_adjustment']!=skill.MAX_LOG_ADJUST
        or fit['features']!=list(skill.FEATURES[:6])):
        raise ValueError('frozen recipe mismatch')
    return tuple(fit['elite_context']),{c:fit['elite_card_effects'][c]-fit['control_card_effects'][c] for c in fit['elite_card_effects']}

def corrections(names,features,metadata,context,cards):
    statuses=[cost_status(metadata.get(n)) for n in names]
    color=[sum(f[i]*context[i] for i in COLOR) for f in features]
    readable=[c for c,s in zip(color,statuses) if s=='readable']
    average=sum(readable)/len(readable) if readable else 0.
    raw=[]
    for n,f,c,s in zip(names,features,color,statuses):
        value=sum(a*b for a,b in zip(f[:6],context))
        if s=='unreadable':
            value+=average-c
        raw.append(value+cards.get(n,0.))
    center=sum(raw)/len(raw)
    return tuple(max(-skill.MAX_LOG_ADJUST,min(skill.MAX_LOG_ADJUST,skill.LAMBDA*(x-center))) for x in raw),statuses

def apply(row,metadata,context,cards):
    delta,_=corrections(row.candidates,row.features,metadata,context,cards)
    return Choice(row.source,row.event_time,row.candidates,row.support,
        tuple(f[:6]+(d,0.) for f,d in zip(row.features,delta)),row.chosen)

def predict_pairs(records,metadata,context,cards):
    return [(apply(r,metadata,context,cards),p,k) for r,p,k in records]

def self_test():
    def spell(cost,text=''):
        return {'id':cost,'layout':'normal','type_line':'Creature','mana_cost':cost,'oracle_text':text}
    meta={'on':spell('{U}'),'off':spell('{R}'),'hybrid':spell('{W/U}'),
          'colorless':spell('{C}'),'generic':spell('{2}'),'cycling':spell('{2}{U}','Cycling {2}'),
          'land':{'id':'land','layout':'normal','type_line':'Land','oracle_text':''},
          'mdfc':{'layout':'modal_dfc','card_faces':[{'type_line':'Creature'},{'type_line':'Land'}]}}
    assert [cost_status(meta[n]) for n in meta]==['readable','readable','unreadable','unreadable','readable','unreadable','land','unreadable']
    context=(.6,-.2,-.1,-.1,.2,-.3)
    on=(.5,0.,0.,0.,0.,0.,0.,0.)
    off=(0.,.5,0.,0.,0.,0.,0.,0.)
    unknown=(0.,)*8
    fixed=(0.,0.,0.,0.,.5,0.,0.,0.)
    names=('on','off','hybrid','cycling','land')
    f=(on,off,unknown,fixed,unknown)
    d,s=corrections(names,f,meta,context,{})
    # Unreadable color term is the mean of .3 and -.1 = .1.
    assert abs(d[2]-(d[0]+d[1])/2)<1e-12
    assert abs(d[3]-d[2]-.05)<1e-12 # recognized fixing remains
    assert abs(d[2]-d[4]-.05)<1e-12 # no invented land spell color
    row=Choice('test','2026-01-01T00:00:00Z',('on','off'),(.6,.4),(on,off),0)
    assert apply(row,meta,context,{})==skill.apply(row,context,{})
    z,_=corrections(('hybrid','colorless'),(unknown,unknown),meta,context,{})
    assert z==(0.,0.)
    x,_=corrections(names,f,meta,context,{'hybrid':100.})
    assert max(map(abs,x))<=skill.MAX_LOG_ADJUST
    print('Neutral-cost contracts passed: readable parity, average, fixing preservation, lands, all-unknown, cap.')
