import { sendEvents } from './growth-api.mjs';

const SEARCH_BASE = 'https://www.tcgplayer.com/search/magic/product';

function config() { return globalThis.PACKONE_TCGPLAYER || {}; }

export function tcgplayerDestination(cardName) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set('q', String(cardName || '').trim());
  url.searchParams.set('view', 'grid');
  return url.toString();
}

export function tcgplayerUrl(cardName) {
  const destination = tcgplayerDestination(cardName);
  const template = String(config().impactDeepLinkTemplate || '').trim();
  if (template && template.includes('{url}')) return template.replace('{url}', encodeURIComponent(destination));
  return destination;
}

export function tcgplayerAffiliateActive() {
  const template = String(config().impactDeepLinkTemplate || '').trim();
  return Boolean(template && template.includes('{url}'));
}

function decorateStaticLinks() {
  document.querySelectorAll('[data-tcgplayer-card]').forEach((link) => {
    const card = link.getAttribute('data-tcgplayer-card');
    if (!card) return;
    link.href = tcgplayerUrl(card);
    link.target = '_blank';
    link.rel = 'sponsored noopener';
    link.dataset.tcgplayerLink = '1';
  });
}

function trackClick(event) {
  const link = event.target.closest?.('[data-tcgplayer-link], [data-tcgplayer-card]');
  if (!link) return;
  const props = {
    card: (link.dataset.tcgplayerCard || '').slice(0, 120) || undefined,
    set: (link.dataset.tcgplayerSet || '').slice(0, 24) || undefined,
    affiliate: tcgplayerAffiliateActive(),
    surface: (link.dataset.tcgplayerSurface || 'unknown').slice(0, 40),
  };
  void sendEvents([{ name: 'tcgplayer_click', props }]);
}

if (typeof document !== 'undefined') {
  decorateStaticLinks();
  document.addEventListener('click', trackClick, true);
}
