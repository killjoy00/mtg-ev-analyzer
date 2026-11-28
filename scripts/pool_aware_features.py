"""Conservative pre-pick features for the offline residual experiment.

Unknown/complex costs abstain. No assertion of a final mana base or winning
value. Specific synergy edges must be independently rules-reviewed; no regex
matching of generic payoff/enabler categories. No live application imports.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import math
import re

COLORS = 'WUBRG'
TYPES = dict(zip(('Plains', 'Island', 'Swamp', 'Mountain', 'Forest'), COLORS))
TOKEN = re.compile(r'\{([^{}]+)\}')
ALT = re.compile(r'\b(?:morph|disguise|prototype|evoke|escape|foretell|plot|suspend|madness|dash|ninjutsu|blitz|spectacle|mutate|convoke|delve|affinity|improvise|emerge|flashback|overload|warp|channel|cycling|landcycling|kicker|offspring|harmonize|renew)\b', re.I)


def canonical(card):
    if not isinstance(card, dict) or card.get('layout') != 'normal' or card.get('card_faces') or card.get('display_faces'):
        return None
    if not all(isinstance(card.get(key), str) and card[key] for key in ('id', 'type_line')) or not isinstance(card.get('oracle_text'), str):
        return None
    return card


def spell_pips(card):
    card = canonical(card)
    if not card or 'Land' in card['type_line'].split(' — ')[0].split() or ALT.search(card['oracle_text']):
        return None
    cost = card.get('mana_cost') or ''
    tokens = TOKEN.findall(cost)
    if not tokens or ''.join('{'+t+'}' for t in tokens) != cost:
        return None
    if any(t not in set(COLORS) and not t.isdecimal() for t in tokens):
        return None
    return Counter(t for t in tokens if t in COLORS)


def fixing_colors(card):
    """Conservative potential access, not a count of unconditional mana sources.

    Direct typed/explicit land routes and generic basic landcycling only. Other
    modes (including conditional mana dorks, fetch restrictions, Treasure and
    alternative costs) are intentionally not represented by this first slice.
    """
    card = canonical(card)
    if not card:
        return frozenset()
    line = card['type_line']
    land = 'Land' in line.split(' — ')[0].split()
    produced = set(card.get('produced_mana') or ()) & set(COLORS)
    text = card['oracle_text']
    result = set()
    if land:
        subtypes = line.partition(' — ')[2].split()
        result.update(TYPES[t] for t in subtypes if t in TYPES and TYPES[t] in produced)
        # No conditional, mana payment or target requirements on this route.
        for part in text.splitlines():
            if re.fullmatch(r'\{T\}: Add (?:\{[WUBRG]\}(?:, | or |, or )?)+\.', part):
                result.update(set(TOKEN.findall(part)) & produced & set(COLORS))
    if re.search(r'(?im)^Basic landcycling \{[12]\}(?:\s|$)', text):
        result.update(COLORS)
    return frozenset(result)


@dataclass(frozen=True)
class Interaction:
    """A human rules-verified specific payoff and enablers, by canonical ID.

    No speculative inferred archetype labels. Supply source provenance outside
    the feature matrix; an empty registry yields zero synergy adjustments.
    """
    payoff: str
    enablers: frozenset[str]
    minimum_distinct: int = 2

    def __post_init__(self):
        if not self.payoff or self.payoff in self.enablers or self.minimum_distinct < 2 or len(self.enablers) < self.minimum_distinct:
            raise ValueError('invalid specific interaction')


def extract(pool, candidates, support, metadata, interactions=()):
    """Return candidate features, plus abstention counts; no choice/outcome input.

    Pool is a sequence of previously selected names (copies retained). Support
    is the frozen unrounded v6 tendency from a source-excluded fit.
    """
    if len(candidates) != len(support) or not candidates or len(set(candidates)) != len(candidates):
        raise ValueError('invalid candidate alignment')
    if any(p <= 0 or not math.isfinite(p) for p in support):
        raise ValueError('invalid raw v6 support')
    interactions = tuple(interactions)
    prior = [canonical(metadata.get(n)) for n in pool]
    available = [canonical(metadata.get(n)) for n in candidates]
    prior_pips = [spell_pips(c) for c in prior]
    known_colored = [p for p in prior_pips if p]
    demand = Counter(c for p in known_colored for c in p)
    source_counts = Counter(c for p in prior for c in fixing_colors(p))
    stage = min(1., len(prior)/8.)
    # Evidence threshold controls when missing access is informative, not a
    # declaration that a drafter has committed to any particular lane.
    commitment = min(1., max(0., (len(known_colored)-2)/4.))
    concentration = sum(demand[c] for c in COLORS if demand[c] >= 2)/max(1,sum(demand.values()))
    known_context = sum(p is not None or bool(fixing_colors(c)) for c,p in zip(prior,prior_pips))/max(1,len(prior))
    strength = stage * commitment * concentration * known_context
    known_ids = {p['id'] for p in prior if p}
    leader = max(support)
    pips = [spell_pips(c) for c in available]
    fully_supported = [bool(p) and all(demand[c] or source_counts[c] for c in p) for p in pips]
    rows = []
    for i, (card, req) in enumerate(zip(available,pips)):
        supported = single = multiple = multi_color = cost = utility = payoff = enabler = 0.
        if req:
            needed = sum(req.values())
            supported = strength * sum(n for c,n in req.items() if demand[c] or source_counts[c])/needed
            missing = [c for c in req if not demand[c] and not source_counts[c]]
            single = strength * sum(req[c] == 1 for c in missing)/max(1,len(req))
            multiple = strength * sum(req[c] for c in missing if req[c] > 1)/needed
            multi_color = strength * max(0,len(missing)-1)/max(1,len(req)-1)
            competing = max((p/leader for j,p in enumerate(support) if j != i and fully_supported[j]), default=0.)
            cost = competing * strength * sum(req[c] for c in missing)/needed
        fixing = fixing_colors(card)
        if len(fixing) >= 2 and demand:
            utility = stage * sum(demand[c]/(1+source_counts[c]) for c in fixing)/sum(demand.values())
        if card:
            identity = card['id']
            for edge in interactions:
                count = len(known_ids & edge.enablers)
                if identity == edge.payoff and count >= edge.minimum_distinct:
                    payoff = max(payoff, stage * min(1., count/4.))
                if identity in edge.enablers and identity not in known_ids and edge.payoff in known_ids and count+1 >= edge.minimum_distinct:
                    enabler = max(enabler, stage * min(1., (count+1)/4.))
        rows.append((supported,single,multiple,multi_color,utility,cost,payoff,enabler))
    return tuple(rows), {'unknown_candidates': sum(c is None for c in available),
                         'unresolved_spell_costs': sum(c is not None and p is None and 'Land' not in c['type_line'].split(' — ')[0].split() for c,p in zip(available,pips)),
                         'unknown_prior': sum(c is None for c in prior)}


def self_test():
    def card(id, cost, type_line='Creature', text='', produced=()):
        return dict(id=id, layout='normal', mana_cost=cost, type_line=type_line,
                    oracle_text=text, produced_mana=list(produced))
    m = {'a':card('a','{W}'), 'b':card('b','{1}{W}'), 'c':card('c','{B}{B}'),
         'd':card('d','{1}{W}'), 'h':card('h','{W/U}'),
         'f':card('f','','Land — Plains Swamp','',('W','B')),
         'p':card('p','{2}{W}'), 'l':card('l','{4}{G}',text='Basic landcycling {2}')}
    edge = Interaction('p', frozenset(('a','b','d')))
    options = ('c','d','h','f','p','l','missing')
    supports = (.25,.25,.1,.1,.1,.1,.1)
    features, coverage = extract(('a','b','a','b','a','b'),options,supports,m,(edge,))
    assert features[0][2]>0 and features[0][5]>0 and features[1][0]>0
    assert features[2][:6] == (0.,)*6 and features[6] == (0.,)*8
    assert features[3][4]>0 and features[4][6]>0 and features[5][4]>0
    assert coverage['unknown_candidates']==1 and coverage['unresolved_spell_costs']==2
    protected,_ = extract(('a','b','a','b','a','f'), options,supports,m)
    assert protected[0][2]==0 and protected[0][5]==0
    early,_ = extract((), options,supports,m,(edge,))
    assert all(f == (0.,)*8 for f in early)
    assert fixing_colors(card('x','','Land','{T}: Add {B} or {R}.',('B','R'))) == frozenset(('B','R'))
    assert not fixing_colors(card('x','','Land','{T}: Add {B} only if you control a Swamp.',('B',)))
    print('Feature synthetic contracts passed; no empirical quality labels.')


if __name__ == '__main__':
    self_test()
