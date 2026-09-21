import {hasAccountSession,loadPatreonStatus} from './growth-api.mjs';

export function syncAccountNavigation({doc=document,signedIn=hasAccountSession()}={}) {
  const nav=doc?.querySelector?.('#account-nav');
  if(!nav)return;
  nav.textContent=signedIn?'My Pack One':'Sign in';
  if(nav.tagName==='A')nav.setAttribute('href','/?account=1');
}


export async function advertisingAllowed({enabled,client,game=false,accountToken,checkMembership}) {
  if(!enabled||!client||game)return false;
  if(!accountToken)return true;
  try{return (await checkMembership()).ads_allowed===true;}catch{return false;}
}

export async function initializeAds({doc=document,location=globalThis.location,
  cfg=globalThis.PACKONE_ADSENSE||{},accountToken=hasAccountSession()?'session':null,
  checkMembership=loadPatreonStatus}={}) {
  const slots=[...doc.querySelectorAll('[data-ad-slot]')];
  // Hide before asynchronous work. Preview queries cannot bypass the release gate.
  slots.forEach(slot=>{slot.hidden=true;slot.replaceChildren();});
  const params=new URLSearchParams(location.search);
  const game=doc.body.classList.contains('is-game')||params.has('game')||params.has('mode');
  if(!slots.length||!await advertisingAllowed({enabled:cfg.enabled,client:cfg.client,game,accountToken,checkMembership}))return;
  // Sign-in may have changed while the membership request was in flight.
  if(Boolean(accountToken)!==hasAccountSession())return;
  const usable=slots.map(slot=>({slot,id:cfg.slots?.[slot.dataset.adSlot]||cfg.slots?.articleTop})).filter(row=>row.id);
  if(!usable.length)return;
  const script=doc.createElement('script');
  script.async=true;script.crossOrigin='anonymous';
  script.src=`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.client)}`;
  const suppress=()=>{usable.forEach(({slot})=>{slot.hidden=true;slot.replaceChildren();});script.remove();};
  globalThis.addEventListener?.('packone-account-changed',suppress,{once:true});
  globalThis.addEventListener?.('storage',event=>{if(event.key==='pack1-auth-session-v1'||event.key===null)suppress();});
  doc.head.appendChild(script);
  for(const {slot,id} of usable){
    const ad=doc.createElement('ins');ad.className='adsbygoogle';ad.style.display='block';
    Object.assign(ad.dataset,{adClient:cfg.client,adSlot:id,adFormat:'auto',fullWidthResponsive:'true'});
    slot.appendChild(ad);slot.hidden=false;
    (globalThis.adsbygoogle=globalThis.adsbygoogle||[]).push({});
  }
}

if(typeof document!=='undefined') {
  syncAccountNavigation();
  globalThis.addEventListener?.('packone-account-changed',()=>syncAccountNavigation());
  globalThis.addEventListener?.('storage',event=>{if(event.key==='pack1-auth-session-v1'||event.key===null)syncAccountNavigation();});
}

export const adsReady=typeof document==='undefined'?Promise.resolve():(async()=>{
  // Static editorial pages need the game's public API endpoints. Disabled ads
  // neither load this configuration nor request membership or Google scripts.
  if(globalThis.PACKONE_ADSENSE?.enabled&&!globalThis.PACK1_API)await import('./leaderboard-config.js');
  await initializeAds();
})();
