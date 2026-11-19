"""Offline pre-pick metadata features. No outcome/choice argument is accepted."""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Mapping

COLORS = 'WUBRG'
TYPES = ('creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'land', 'planeswalker')
ROLE_RULES = {
    'removal_proxy': r'(?:destroy|exile) target (?:creature|permanent)|deals? \d+ damage to (?:any target|target creature)|target creature gets -\d+/-\d+',
    'draw_proxy': r'draw (?:a|two|three|\d+) cards?',
    'fixing_proxy': r'(?:add|mana of) any color|search your library for (?:a|up to two) basic land',
    'token_proxy': r'create(?:s)? .{0,80}token',
    'sacrifice_payoff_proxy': r'whenever .{0,80}(?:dies|sacrifice)',
    'graveyard_payoff_proxy': r'(?:cards?|creatures?) in your graveyard',
    'mill_proxy': r'(?:you )?mill (?:two|three|four|\d+)',
    'artifact_payoff_proxy': r'whenever .{0,60}artifact|for each artifact|artifacts? you control',
    'enchantment_payoff_proxy': r'whenever .{0,60}enchantment|for each enchantment|enchantments? you control',
}


@dataclass(frozen=True)
class PickState:
    set_id: str
    pick: int  # one-based Pack 1 pick
    candidates: tuple[str, ...]
    pool: tuple[tuple[str, int], ...]

    def __post_init__(self):
        if not 1 <= self.pick <= 8:
            raise ValueError('Only P1P1–P1P8 is supported')
        if not self.candidates or len(set(self.candidates)) != len(self.candidates):
            raise ValueError('Unique candidate names are required')
        if len(dict(self.pool)) != len(self.pool) or any(n <= 0 for _, n in self.pool):
            raise ValueError('Pool must contain unique names and positive counts')
        if sum(n for _, n in self.pool) != self.pick - 1:
            raise ValueError('Pool must contain the complete pre-pick prefix')


def card_features(card: Mapping | None) -> dict[str, float]:
    """Conservative proxies, with explicit missingness and complex-face flags."""
    card = card or {}
    cost = card.get('mana_cost')
    typ = str(card.get('type_line') or '').lower()
    text = card.get('oracle_text')
    faces = card.get('card_faces') or []
    complex_card = bool(faces or '//' in str(card.get('name', '')))
    # Split/transform/adventure costs have different semantics. Do not add them.
    symbols = re.findall(r'\{([^}]+)\}', cost or '')
    known_cost = cost is not None and (bool(symbols) or 'land' in typ) and not complex_card
    mv = 0.0
    if known_cost:
        for symbol in symbols:
            if symbol.isdigit():
                mv += int(symbol)
            elif symbol in ('X', 'Y', 'Z'):
                continue
            elif '/' in symbol:
                mv += max([int(s) if s.isdigit() else 1 for s in symbol.split('/')])
            else:
                mv += 1
    result = {'metadata_missing': float(not card), 'cost_missing': float(not known_cost),
              'complex_card': float(complex_card), 'text_missing': float(text is None),
              'mana_value': mv, 'variable_cost': float(any(s in ('X','Y','Z') for s in symbols))}
    for t in TYPES:
        result[t] = float(bool(re.search(r'\b' + t + r'\b', typ.split('—')[0])))
    for c in COLORS:
        result['color_' + c] = float(any(c in s.split('/') for s in symbols))
    result['cheap_creature'] = float(known_cost and 0 < mv <= 2 and result['creature'])
    result['expensive_spell'] = float(known_cost and mv >= 5 and not result['land'])
    result['colored_pips'] = float(sum(any(c in s.split('/') for c in COLORS) for s in symbols))
    for name, pattern in ROLE_RULES.items():
        result[name] = float(text is not None and bool(re.search(pattern, text.lower())))
    return result


def subtypes(card: Mapping | None) -> set[str]:
    typ = str((card or {}).get('type_line') or '').lower()
    if 'creature' not in typ or '—' not in typ or '//' in typ:
        return set()
    return set(typ.split('—', 1)[1].split())


def feature_blocks(state: PickState, candidate: str, metadata: Mapping[str, Mapping],
                   strength: tuple[float, int] = (.5, 0)) -> tuple[dict, dict, dict]:
    if candidate not in state.candidates:
        raise ValueError('Candidate was not offered')
    gih, support = strength
    if not math.isfinite(gih) or not 0 <= gih <= 1 or support < 0:
        raise ValueError('Invalid training-complement strength')
    cf = card_features(metadata.get(candidate))
    base = {'pick': state.pick, 'pool_size': state.pick-1, 'candidate_count': len(state.candidates),
            'gih': gih, 'gih_missing': float(support == 0), 'gih_log_support': math.log1p(support),
            **{'card_' + k: v for k, v in cf.items()}}
    totals = Counter()
    tribal = 0
    for name, count in state.pool:
        pf = card_features(metadata.get(name))
        totals.update({k: v*count for k,v in pf.items()})
        if subtypes(metadata.get(candidate)) & subtypes(metadata.get(name)):
            tribal += count
    denom = max(1, state.pick-1)
    pool = {'pool_' + k: totals[k] / denom for k in cf}
    interactions = {'tribal_matches': tribal/denom}
    for k in ('cheap_creature', 'expensive_spell', *TYPES, *ROLE_RULES):
        interactions[k + '_redundancy'] = cf[k] * totals[k] / denom
    interactions['cheap_with_expensive_pool'] = cf['cheap_creature'] * totals['expensive_spell']/denom
    interactions['expensive_with_cheap_pool'] = cf['expensive_spell'] * totals['cheap_creature']/denom
    interactions['color_overlap'] = sum(cf['color_'+c]*totals['color_'+c]/denom for c in COLORS)
    interactions['new_colors'] = sum(cf['color_'+c] and totals['color_'+c] == 0 for c in COLORS)
    interactions['fixing_with_color_spread'] = cf['fixing_proxy']*sum(totals['color_'+c]>0 for c in COLORS)
    for payoff, enabler in [('sacrifice_payoff_proxy','token_proxy'), ('graveyard_payoff_proxy','mill_proxy'),
                             ('artifact_payoff_proxy','artifact'), ('enchantment_payoff_proxy','enchantment')]:
        interactions[payoff+'_with_enablers'] = cf[payoff]*totals[enabler]/denom
        interactions[enabler+'_with_payoffs'] = cf[enabler]*totals[payoff]/denom
    return base, pool, interactions


def diagnostic_flags(state: PickState, metadata: Mapping[str, Mapping]) -> list[str]:
    rows = [card_features(metadata.get(c)) for c in state.candidates]
    pool = [card_features(metadata.get(c)) for c,n in state.pool for _ in range(n)]
    flags = []
    if any(r['land'] for r in rows) and any(not r['land'] for r in rows): flags.append('land_vs_spell')
    if any(r['cheap_creature'] for r in rows) and any(r['expensive_spell'] for r in rows): flags.append('curve_tradeoff')
    if sum(any(r['color_'+c] for r in pool) for c in COLORS) >= 3: flags.append('spread_colors')
    if any(subtypes(metadata.get(c)) & subtypes(metadata.get(p)) for c in state.candidates for p,_ in state.pool): flags.append('shared_creature_type')
    if any(r['metadata_missing'] or r['complex_card'] for r in rows+pool): flags.append('metadata_limit')
    return flags
