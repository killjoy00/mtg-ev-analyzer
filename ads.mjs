import {ACCOUNT_SIGNAL_KEY,hasAccountSession,loadPatreonStatus} from './growth-api.mjs';
import {onAppRender} from './render-lifecycle.mjs';

const SLOT_CONFIG_KEYS=Object.freeze({home:'home','article-top':'articleTop'});
const sessionPresent=()=>{try{return hasAccountSession();}catch{return false;}};

export function slotIdForPlacement(cfg,placement) {
  const key=SLOT_CONFIG_KEYS[String(placement||'')];
  return key?String(cfg?.slots?.[key]||''):'';
}

export function syncAccountNavigation({doc=document,signedIn=null}={}) {
  const nav=doc?.querySelector?.('#account-nav');
  if(!nav)return;
  const firstPartyHint=/(?:^|;\s*)__Secure-pack1_csrf=/.test(String(doc.cookie||''));
  const active=signedIn==null?(sessionPresent()||firstPartyHint):Boolean(signedIn);
  nav.textContent=active?'My Pack One':'Sign in';
  if(nav.tagName==='A')nav.setAttribute('href','/?account=1');
}

export async function advertisingAllowed({enabled,client,game=false,accountToken,checkMembership}) {
  if(!enabled||!client||game)return false;
  if(!accountToken)return true;
  try{return (await checkMembership()).ads_allowed===true;}catch{return false;}
}

function gameView(doc,location) {
  const params=new URLSearchParams(location?.search||'');
  return doc.body?.classList?.contains('is-game')||params.has('game')||params.has('mode');
}

function clearRows(rows) {
  rows.forEach(({slot})=>{slot.hidden=true;slot.replaceChildren();});
}

export async function initializeAds({doc=document,location=globalThis.location,
  cfg=globalThis.PACKONE_ADSENSE||{},accountToken=undefined,
  checkMembership=loadPatreonStatus}={}) {
  const slots=[...doc.querySelectorAll('[data-ad-slot]')];
  // Hide before asynchronous work. Preview queries cannot bypass the release gate.
  slots.forEach(slot=>{slot.hidden=true;slot.replaceChildren();});
  if(!slots.length||cfg.enabled!==true||!cfg.client)return;

  const usable=slots.map(slot=>({slot,placement:slot.dataset.adSlot,id:slotIdForPlacement(cfg,slot.dataset.adSlot)})).filter(row=>row.id);
  if(!usable.length)return;

  let stopped=false,script=null,unsubscribe=null;
  const suppress=()=>{
    if(stopped)return;
    stopped=true;
    clearRows(usable);
    script?.remove();
    unsubscribe?.();
  };
  globalThis.addEventListener?.('packone-account-changed',suppress,{once:true});
  globalThis.addEventListener?.('storage',event=>{
    if(event.key==='pack1-auth-session-v1'||event.key===ACCOUNT_SIGNAL_KEY||event.key===null)suppress();
  });

  const fill=rows=>{
    if(stopped||!rows.length)return;
    if(!script){
      script=doc.createElement('script');
      script.async=true;script.crossOrigin='anonymous';
      script.src=`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.client)}`;
      doc.head.appendChild(script);
    }
    for(const {slot,id} of rows){
      const ad=doc.createElement('ins');ad.className='adsbygoogle';ad.style.display='block';
      Object.assign(ad.dataset,{adClient:cfg.client,adSlot:id,adFormat:'auto',fullWidthResponsive:'true'});
      slot.appendChild(ad);slot.hidden=false;
      (globalThis.adsbygoogle=globalThis.adsbygoogle||[]).push({});
    }
  };

  // Editorial placements keep their existing one-shot load-time behavior.
  const staticRows=usable.filter(row=>row.placement!=='home');
  if(staticRows.length){
    const token=accountToken===undefined?(sessionPresent()?'session':null):accountToken;
    const signed=Boolean(token);
    const allowed=await advertisingAllowed({enabled:cfg.enabled,client:cfg.client,game:gameView(doc,location),accountToken:token,checkMembership});
    if(allowed&&!stopped&&signed===sessionPresent())fill(staticRows);
  }

  const homeRows=usable.filter(row=>row.placement==='home');
  if(!homeRows.length)return;

  // The Daily home is a positive allowlist. Wait for its first render, evaluate
  // eligibility exactly once, and never refill on this document after leaving,
  // an account/membership signal, a failed/uncertain check, or a successful fill.
  const state={seen:false,checked:false,checking:false,spent:false};
  const handleHomeRender=async()=>{
    if(stopped||state.spent)return;
    if(gameView(doc,location)){state.spent=true;clearRows(homeRows);return;}
    const home=Boolean(doc.querySelector('#app')?.querySelector('[data-daily-home]'));
    if(!home){
      if(state.seen){state.spent=true;clearRows(homeRows);}
      return;
    }
    state.seen=true;
    if(state.checked||state.checking)return;
    state.checked=true;state.checking=true;
    const token=accountToken===undefined?(sessionPresent()?'session':null):accountToken;
    const signed=Boolean(token);
    const allowed=await advertisingAllowed({enabled:cfg.enabled,client:cfg.client,game:false,accountToken:token,checkMembership});
    state.checking=false;
    if(stopped||state.spent)return;
    if(!doc.querySelector('#app')?.querySelector('[data-daily-home]')){state.spent=true;clearRows(homeRows);return;}
    if(signed!==sessionPresent()){state.spent=true;clearRows(homeRows);return;}
    state.spent=true;
    if(allowed)fill(homeRows);
  };
  unsubscribe=onAppRender(handleHomeRender);
}

if(typeof document!=='undefined') {
  syncAccountNavigation();
  globalThis.addEventListener?.('packone-account-changed',()=>syncAccountNavigation());
  globalThis.addEventListener?.('storage',event=>{
    if(event.key==='pack1-auth-session-v1'||event.key===ACCOUNT_SIGNAL_KEY||event.key===null)syncAccountNavigation();
  });
}

export const adsReady=typeof document==='undefined'?Promise.resolve():(async()=>{
  // Static editorial pages need the game's public API endpoints. Disabled ads
  // neither load this configuration nor request membership or Google scripts.
  if(globalThis.PACKONE_ADSENSE?.enabled&&!globalThis.PACK1_API)await import('./leaderboard-config.js');
  await initializeAds();
})();
