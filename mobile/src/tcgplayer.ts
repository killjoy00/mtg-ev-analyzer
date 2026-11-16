const MAGIC_SHOP_BASE = 'https://www.tcgplayer.com/categories/trading-and-collectible-card-games/magic-the-gathering';
const IMPACT_DEEP_LINK = 'https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}';

export function tcgplayerMagicUrl() {
  return IMPACT_DEEP_LINK.replace('{url}', encodeURIComponent(MAGIC_SHOP_BASE));
}
