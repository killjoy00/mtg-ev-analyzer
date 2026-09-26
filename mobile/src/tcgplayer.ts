const SEARCH_BASE = 'https://www.tcgplayer.com/search/magic/product';
const IMPACT_DEEP_LINK = 'https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}';

export function tcgplayerDestination(cardName: string) {
  const name = String(cardName || '').trim();
  if (!name || name.length > 200) throw new Error('Invalid TCGplayer card name.');
  return `${SEARCH_BASE}?q=${encodeURIComponent(name)}&view=grid`;
}

export function tcgplayerUrl(cardName: string) {
  return IMPACT_DEEP_LINK.replace('{url}', encodeURIComponent(tcgplayerDestination(cardName)));
}
