import {ACCOUNT_SIGNAL_KEY,hasAccountSession,loadPatreonStatus} from './growth-api.mjs';
import {onAppRender} from './render-lifecycle.mjs';
import {tcgplayerHomeBannerActive,tcgplayerMagicUrl} from './tcgplayer.mjs';

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

export async function promotionalContentAllowed({active=true,game=false,accountToken,checkMembership}) {
  if(!active||game)return false;
  if(!accountToken)return true;
  try{return (await checkMembership()).ads_allowed===true;}catch{return false;}
}

export async function advertisingAllowed({enabled,client,game=false,accountToken,checkMembership}) {
  return promotionalContentAllowed({active:Boolean(enabled&&client),game,accountToken,checkMembership});
}

function gameView(doc,location) {
  const params=new URLSearchParams(location?.search||'');
  return doc.body?.classList?.contains('is-game')||params.has('game')||params.has('mode');
}

function clearRows(rows) {
  rows.forEach(({slot})=>{
    slot.hidden=true;
    slot.replaceChildren();
    delete slot.dataset.slotContent;
  });
}

export async function initializeAds({doc=document,location=globalThis.location,
  cfg=globalThis.PACKONE_ADSENSE||{},accountToken=undefined,
  checkMembership=loadPatreonStatus}={}) {
  const slots=[...doc.querySelectorAll('[data-ad-slot]')];
  // Hide before asynchronous work. Preview queries cannot bypass either release gate.
  slots.forEach(slot=>{slot.hidden=true;slot.replaceChildren();delete slot.dataset.slotContent;});
  if(!slots.length)return;

  const googleActive=cfg.enabled===true&&Boolean(cfg.client);
  // The affiliate unit is a fallback, never a companion placement. Once the
  // reviewed Google gate is enabled, a broken/missing Google config fails closed
  // rather than silently restoring affiliate content.
  const affiliateActive=cfg.enabled!==true&&tcgplayerHomeBannerActive();
  if(!googleActive&&!affiliateActive)return;

  const googleRows=googleActive
    ? slots.map(slot=>({slot,placement:slot.dataset.adSlot,id:slotIdForPlacement(cfg,slot.dataset.adSlot)})).filter(row=>row.id)
    : [];
  const staticRows=googleRows.filter(row=>row.placement!=='home');
  const homeRows=googleActive
    ? googleRows.filter(row=>row.placement==='home')
    : slots.filter(slot=>slot.dataset.adSlot==='home').map(slot=>({slot,placement:'home',id:''}));
  const activeRows=[...staticRows,...homeRows];
  if(!activeRows.length)return;

  let stopped=false,script=null,unsubscribe=null;
  const suppress=()=>{
    if(stopped)return;
    stopped=true;
    clearRows(activeRows);
    script?.remove();
    unsubscribe?.();
  };
  globalThis.addEventListener?.('packone-account-changed',suppress,{once:true});
  globalThis.addEventListener?.('storage',event=>{
    if(event.key==='pack1-auth-session-v1'||event.key===ACCOUNT_SIGNAL_KEY||event.key===null)suppress();
  });

  const fillGoogle=rows=>{
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
      slot.dataset.slotContent='google';
      slot.appendChild(ad);slot.hidden=false;
      (globalThis.adsbygoogle=globalThis.adsbygoogle||[]).push({});
    }
  };

  const fillAffiliate=rows=>{
    if(stopped||!rows.length)return;
    const href=tcgplayerMagicUrl();
    if(!href)return;
    for(const {slot} of rows){
      const promo=doc.createElement('div');
      promo.className='tcg-affiliate-promo';

      const link=doc.createElement('a');
      link.className='tcg-affiliate-link';
      link.href=href;
      link.target='_blank';
      link.rel='sponsored noopener';
      link.dataset.tcgplayerLink='1';
      link.dataset.tcgplayerSurface='daily_home_banner';
      link.setAttribute('aria-label','Shop Magic cards on TCGplayer (affiliate link)');

      const logoWrap=doc.createElement('span');
      logoWrap.className='tcg-affiliate-logo-wrap';
      const logo=doc.createElement('img');
      logo.className='tcg-affiliate-logo';
      logo.src='/assets/tcgplayer-logo-primary-stroke.webp';
      logo.alt='TCGplayer';
      logo.width=512;
      logo.height=227;
      logo.decoding='async';
      logoWrap.appendChild(logo);

      const copy=doc.createElement('span');
      copy.className='tcg-affiliate-copy';
      const headline=doc.createElement('strong');
      headline.textContent='Shop Magic cards';
      const detail=doc.createElement('span');
      detail.textContent='Singles, sealed product, and more';
      copy.append(headline,detail);

      const cta=doc.createElement('span');
      cta.className='tcg-affiliate-cta';
      cta.textContent='Shop now →';

      link.append(logoWrap,copy,cta);

      const disclosure=doc.createElement('p');
      disclosure.className='tcg-affiliate-disclosure';
      disclosure.textContent='Affiliate link — Pack One may earn a commission from purchases.';

      promo.append(link,disclosure);
      slot.dataset.slotContent='affiliate';
      slot.appendChild(promo);
      slot.hidden=false;
    }
  };

  // Editorial placements keep their existing one-shot Google behavior. The
  // TCGplayer fallback is deliberately Daily-home-only.
  if(staticRows.length){
    const token=accountToken===undefined?(sessionPresent()?'session':null):accountToken;
    const signed=Boolean(token);
    const allowed=await advertisingAllowed({enabled:cfg.enabled,client:cfg.client,game:gameView(doc,location),accountToken:token,checkMembership});
    if(allowed&&!stopped&&signed===sessionPresent())fillGoogle(staticRows);
  }

  if(!homeRows.length)return;

  // The Daily home is a positive allowlist. Wait for its first render, evaluate
  // eligibility exactly once, and never refill on this document after leaving,
  // an account/membership signal, a failed/uncertain check, or a successful fill.
  const state={seen:false,checked:false,checking:false,spent:false,filled:false};
  const stopWatchingHome=()=>{unsubscribe?.();unsubscribe=null;};
  const handleHomeRender=async()=>{
    if(stopped)return;
    if(gameView(doc,location)){
      state.spent=true;state.filled=false;clearRows(homeRows);stopWatchingHome();return;
    }
    const home=Boolean(doc.querySelector('#app')?.querySelector('[data-daily-home]'));
    if(!home){
      if(state.seen){
        state.spent=true;state.filled=false;clearRows(homeRows);stopWatchingHome();
      }
      return;
    }
    state.seen=true;
    // A successful fill is spent for refill purposes, but its listener stays
    // alive until the view leaves Daily so the rendered promotion can be cleared.
    if(state.spent||state.checked||state.checking)return;
    state.checked=true;state.checking=true;
    const token=accountToken===undefined?(sessionPresent()?'session':null):accountToken;
    const signed=Boolean(token);
    const allowed=await promotionalContentAllowed({active:true,game:false,accountToken:token,checkMembership});
    state.checking=false;
    if(stopped||state.spent)return;
    if(!doc.querySelector('#app')?.querySelector('[data-daily-home]')){
      state.spent=true;clearRows(homeRows);stopWatchingHome();return;
    }
    if(signed!==sessionPresent()){
      state.spent=true;clearRows(homeRows);stopWatchingHome();return;
    }
    state.spent=true;
    if(allowed){
      state.filled=true;
      if(googleActive)fillGoogle(homeRows);else fillAffiliate(homeRows);
    } else stopWatchingHome();
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
  // Google editorial delivery and the signed-in Daily-home affiliate fallback
  // need the public API configuration. Guests still render the affiliate unit
  // without a membership request.
  const homeAffiliate=Boolean(document.querySelector('[data-ad-slot="home"]'))
    &&globalThis.PACKONE_ADSENSE?.enabled!==true
    &&tcgplayerHomeBannerActive();
  if((globalThis.PACKONE_ADSENSE?.enabled||homeAffiliate)&&!globalThis.PACK1_API)await import('./leaderboard-config.js');
  await initializeAds();
})();
