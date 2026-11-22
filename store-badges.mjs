// Make the store badges useful on phones without redirecting visitors.
// Unknown devices and crawlers keep both original listing links visible.
export function storePlatform(nav={}) {
  const agent=String(nav.userAgent||'');
  const platform=String(nav.userAgentData?.platform||nav.platform||'');
  if(/Android/i.test(agent)||/Android/i.test(platform))return 'android';
  if(/iPhone|iPad|iPod/i.test(agent)||/iPhone|iPad|iPod|iOS|iPadOS/i.test(platform))return 'ios';
  // iPadOS can request a desktop site and report MacIntel.
  if(/MacIntel|Macintosh/i.test(platform)&&Number(nav.maxTouchPoints||0)>1)return 'ios';
  return 'both';
}

export function applyStoreBadges(root,nav={}) {
  if(!root?.querySelectorAll)return;
  const platform=storePlatform(nav);
  const label=platform==='ios'?'Also on iPhone and iPad'
    :platform==='android'?'Also on Android':'Also on iPhone and Android';
  for(const group of root.querySelectorAll('[data-store-links]')) {
    const copy=group.querySelector('[data-store-label]');
    if(copy)copy.textContent=label;
    for(const badge of group.querySelectorAll('[data-store-badge]')) {
      badge.hidden=platform!=='both'&&badge.getAttribute('data-store-badge')!==platform;
    }
  }
}

// Editorial pages have server-rendered badges; the Daily home calls this again
// immediately after each client-side render.
if(typeof document!=='undefined'&&typeof navigator!=='undefined')applyStoreBadges(document,navigator);
