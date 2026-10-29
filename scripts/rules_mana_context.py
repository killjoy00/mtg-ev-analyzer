"""Research inputs for partial-credit context; never a points/quality heuristic.

Card mana requirements come from explicit metadata, not the main colors of
decks that happened to play it. Unsupported costs/layouts stay unknown. This
first implementation deliberately does not resolve alternative casting costs.
"""
from __future__ import annotations

from collections import Counter
import re

COLORS = 'WUBRG'
TOKEN = re.compile(r'\{([^{}]+)\}')


def simple_mana_cost(cost):
    """Return required colored pips for ordinary costs, None for unsupported.

    A zero-mana spell must explicitly say {0}; an empty spell cost is unknown.
    Colorless mana {C} is a requirement too and is returned separately.
    """
    if not isinstance(cost, str) or not cost:
        return None
    tokens = TOKEN.findall(cost)
    if ''.join('{' + t + '}' for t in tokens) != cost:
        return None
    if any(not (t in set(COLORS + 'CXYZ') or t.isdecimal()) for t in tokens):
        return None
    pips = Counter(t for t in tokens if t in COLORS)
    return {'colors': [c for c in COLORS if pips[c]],
            'colored_pips': {c: pips[c] for c in COLORS if pips[c]},
            'colorless_pips': tokens.count('C'),
            'generic_mana': sum(int(t) for t in tokens if t.isdecimal()),
            'variable_cost': any(t in 'XYZ' for t in tokens)}


def card_mana_context(card):
    if not isinstance(card, dict):
        return {'status': 'unknown', 'reason': 'missing_metadata'}
    # Back faces, Adventures, Rooms and other modal cards need explicit routes.
    if card.get('card_faces') or card.get('display_faces'):
        return {'status': 'unknown', 'reason': 'unsupported_layout'}
    if 'layout' not in card:
        return {'status': 'unknown', 'reason': 'missing_layout'}
    if card['layout'] != 'normal':
        return {'status': 'unknown', 'reason': 'unsupported_layout'}
    type_line = card.get('type_line')
    types = type_line.split(' — ')[0].split() if isinstance(type_line, str) else []
    if not types:
        return {'status': 'unknown', 'reason': 'missing_type'}
    land = 'Land' in types
    cast = None if land else simple_mana_cost(card.get('mana_cost'))
    if not land and cast is None:
        return {'status': 'unknown', 'reason': 'missing_or_unsupported_mana_cost'}
    text = card.get('oracle_text')
    produced = card.get('produced_mana')
    produced_valid = isinstance(produced, list) and all(isinstance(c, str) and c in set(COLORS + 'C') for c in produced)
    # Preserve the mode and activation cost. A generic cycling mode is not a
    # green spell and does not mean that the creature itself is freely castable.
    cycling = None
    if isinstance(text, str):
        match = re.search(r'(?im)^Basic landcycling ((?:\{[^{}]+\})+)', text)
        if match:
            activation = simple_mana_cost(match.group(1))
            cycling = {'status': 'known' if activation is not None else 'unsupported_cost',
                       'activation_cost': activation, 'finds_basic_colors': list(COLORS)}
    return {
        'status': 'known', 'land': land, 'cast': cast,
        'produced_mana': produced if produced_valid else None,
        'basic_landcycling': cycling,
        'rules_text_available': isinstance(text, str),
        'scope': 'Explicit mana costs and basic landcycling only; not complete rules evaluation.',
    }


def candidate_pool_context(candidate, prior_cards):
    """Observed color demand, not a hard lane assignment or castability model."""
    prior = [card_mana_context(card) for card in prior_cards]
    counts = Counter()
    for card in prior:
        if card['status'] == 'known' and card.get('cast'):
            counts.update(card['cast']['colors'])
    value = card_mana_context(candidate)
    needed = value.get('cast', {}).get('colors') if value.get('cast') else None
    return {
        'card': value,
        'prior_cards_requiring_color': {c: counts[c] for c in COLORS},
        'prior_cards_with_unknown_mana_context': sum(c['status'] != 'known' for c in prior),
        'new_required_colors': [c for c in needed if not counts[c]] if needed is not None else None,
        'required_color_overlap': {c: counts[c] for c in needed} if needed is not None else None,
    }
