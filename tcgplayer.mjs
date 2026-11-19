import { sendEvents, getAuthSession, loadPatreonStatus, ACCOUNT_SIGNAL_KEY } from './growth-api.mjs';
import {onAppRender} from './render-lifecycle.mjs';
import {cardCommerceAllowed} from './membership-source.mjs';

const SEARCH_BASE = 'https://www.tcgplayer.com/search/magic/product';
const MAGIC_SHOP_BASE = 'https://www.tcgplayer.com/categories/trading-and-collectible-card-games/magic-the-gathering';

function config() { return globalThis.PACKONE_TCGPLAYER || {}; }

export function tcgplayerDestination(cardName) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set('q', String(cardName || '').trim());
  url.searchParams.set('view', 'grid');
  return url.toString();
}

export function tcgplayerAffiliateUrl(destination) {
  const target = String(destination || '').trim();
  const template = String(config().impactDeepLinkTemplate || '').trim();
  if (target && template && template.includes('{url}')) return template.replace('{url}', encodeURIComponent(target));
  return target;
}

export function tcgplayerUrl(cardName) {
  return tcgplayerAffiliateUrl(tcgplayerDestination(cardName));
}

export function tcgplayerMagicUrl() {
  return tcgplayerAffiliateUrl(String(config().homeDestination || '').trim() || MAGIC_SHOP_BASE);
}

export function tcgplayerAffiliateActive() {
  const template = String(config().impactDeepLinkTemplate || '').trim();
  return Boolean(template && template.includes('{url}'));
}

export function tcgplayerHomeBannerActive() {
  return config().homeBannerEnabled === true && tcgplayerAffiliateActive();
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
  if (link.hasAttribute('data-tcgplayer-card') && document.documentElement.dataset.cardCommerceAllowed !== 'true') {
    event.preventDefault();
    return;
  }
  const props = {
    card: (link.dataset.tcgplayerCard || '').slice(0, 120) || undefined,
    set: (link.dataset.tcgplayerSet || '').slice(0, 24) || undefined,
    affiliate: tcgplayerAffiliateActive(),
    surface: (link.dataset.tcgplayerSurface || 'unknown').slice(0, 40),
  };
  void sendEvents([{ name: 'tcgplayer_click', props }]);
}

// Shared by dynamic pick reveals and static set archives. Hide first and on
// identity changes; an older response cannot re-enable another account's links.
export function createCardCommerceController({setAllowed,account, membership}) {
  let generation=0;
  return async function refresh() {
    const current=++generation;
    setAllowed(false);
    try {
      const session=await account();
      const allowed=session?.user ? cardCommerceAllowed(await membership()) : true;
      if(current===generation)setAllowed(allowed);
    } catch { /* Keep promotions hidden when access cannot be checked. */ }
  };
}

if (typeof document !== 'undefined') {
  const refresh=createCardCommerceController({
    setAllowed:allowed=>{document.documentElement.dataset.cardCommerceAllowed=String(allowed);},
    account:async()=>{
      if(!globalThis.PACK1_API)await import('./leaderboard-config.js');
      if(!globalThis.PACK1_API)throw Error('Account configuration unavailable.');
      return getAuthSession();
    },
    membership:loadPatreonStatus,
  });
  let initialized=false;
  const ensureCards=()=>{
    if(!initialized && document.querySelector('[data-tcgplayer-card]')) {
      initialized=true;decorateStaticLinks();void refresh();
    }
  };
  const refreshCards=()=>{if(initialized)void refresh();};
  document.addEventListener('click', trackClick, true);
  globalThis.addEventListener('packone-account-changed',refreshCards);
  globalThis.addEventListener('storage',event=>{
    if(event.key===ACCOUNT_SIGNAL_KEY||event.key==='pack1-auth-session-v1'||event.key===null)refreshCards();
  });
  globalThis.addEventListener('focus',refreshCards);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshCards();});
  onAppRender(ensureCards);
  ensureCards();
}
