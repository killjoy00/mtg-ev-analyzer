"""Normalize Scryfall's image-bearing faces; never infer a back image URL."""
from urllib.parse import urlsplit


def safe_image(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if url.scheme == 'https' and url.hostname == 'cards.scryfall.io' and not url.username and not url.password and not url.port:
            return value
    except ValueError:
        pass
    return None


def face_record(face, role, **extra):
    if not isinstance(face, dict):
        return None
    uris = face.get('image_uris') or {}
    url = safe_image(uris.get('normal'))
    name = str(face.get('name') or '').strip()
    if not url or not name:
        return None
    result = {'name': name, 'image_url': url, 'role': role, **extra}
    large = safe_image(uris.get('large'))
    if large:
        result['large_image_url'] = large
    return result


def display_faces(card, lookup=None):
    """Return two complete views or none. Related tokens are never back faces.

    lookup is only needed for meld; callers supply a bulk index or cached API
    reader. Ordinary split/adventure/flip cards have a whole-card image and
    are deliberately not classified by their name or card_faces count.
    """
    if card.get('layout') == 'meld':
        parts = card.get('all_parts') or []
        result = next((p for p in parts if p.get('component') == 'meld_result'), None)
        if not result or result.get('id') == card.get('id') or not lookup:
            return []
        partner = next((p.get('name') for p in parts if p.get('component') == 'meld_part' and p.get('id') != card.get('id')), None)
        if not partner:
            return []
        front = face_record(card, 'front')
        back = face_record(lookup(result['id']), 'meld_result', partner_name=partner)
        return [front, back] if front and back else []
    if card.get('image_uris') or card.get('layout') in {'art_series', 'double_faced_token'}:
        return []
    faces = card.get('card_faces') or []
    if len(faces) != 2:
        return []
    result = [face_record(face, role) for face, role in zip(faces, ['front', 'back'])]
    if all(result) and result[0]['image_url'] != result[1]['image_url']:
        return result
    return []
