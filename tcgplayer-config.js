// Public configuration only. Do not put API secrets here.
window.PACKONE_TCGPLAYER = Object.freeze({
  program: 'Impact',
  // Approved TCGplayer/Impact referral route. {url} is replaced with the encoded destination.
  impactDeepLinkTemplate: 'https://partner.tcgplayer.com/c/7742974/1780961/21018?u={url}',
  // Independent kill switch for the Daily-home affiliate fallback.
  homeBannerEnabled: true,
  homeDestination: 'https://www.tcgplayer.com/categories/trading-and-collectible-card-games/magic-the-gathering',
  disclosure: 'Pack One may earn a commission from eligible purchases made through TCGplayer links.'
});
