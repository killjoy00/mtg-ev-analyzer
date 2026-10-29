import {escapeHtml as esc} from './html.mjs';

// Editorial coverage is independent of the serving catalog. A future set only
// receives a guide link after its content has been reviewed and published.
export const GUIDE_IDS = Object.freeze(['fra','hob','msh','sos','tmt','ecl','tla','eoe','fin','tdm','dft','fdn','dsk','blb','mh3','otj','mkm','ktk','lci','woe','ltr','mom','one','bro','dmu','snc','neo','powered-cube']);
export const hasSetGuide = id => GUIDE_IDS.includes(String(id || '').toLowerCase());
export const setGuidePath = id => hasSetGuide(id) ? `/sets/${String(id).toLowerCase()}/guide/` : null;
const safeLink = value => {try {const url=new URL(value);return url.protocol==='https:'?url.href:'';}catch{return '';}};
const colors={W:'White',U:'Blue',B:'Black',R:'Red',G:'Green'};
const colorNames=value=>[...String(value)].map(c=>colors[c]||c).join('–');
const count=value=>Number(value||0).toLocaleString('en-US');
const percent=row=>row.games>0?`${(100*row.wins/row.games).toFixed(1)}%`:'—';
const date=value=>new Date(value).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
const colorMark=value=>`<span class="guide-colors" aria-label="${esc(colorNames(value))}">${[...String(value)].map(c=>`<span class="guide-mana guide-mana-${esc(c.toLowerCase())}" aria-hidden="true">${esc(c)}</span>`).join('')}</span>`;

export function setRefresherButton(id) {
  return hasSetGuide(id)?`<button type="button" class="text-button set-refresher-trigger" data-set-refresher="${esc(String(id).toLowerCase())}" aria-haspopup="dialog">Set refresher <span aria-hidden="true">↗</span></button>`:'';
}

export function renderRefresher(guide) {
  return `<div class="guide-format"><h3>Format reminders</h3><ul>${guide.notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></div>
    <h3>Archetypes</h3><p class="guide-caption">${esc(guide.archetypeNote||'The main starting points for this format. Follow the cards available to you.')}</p>
    <div class="guide-archetypes">${guide.archetypes.map(a=>`<details class="guide-archetype"><summary>${colorMark(a.colors)}<span><strong>${esc(a.name)}</strong><span>${esc(a.plan)}</span></span></summary><p>${esc(a.detail)}</p></details>`).join('')}</div>
    ${guide.mechanics?.length?`<details class="guide-mechanics"><summary>Mechanics at a glance</summary><dl>${guide.mechanics.map(m=>`<dt>${esc(m.name)}</dt><dd>${esc(m.text)}</dd>`).join('')}</dl></details>`:''}`;
}

export function renderResults(guide) {
  const result=guide.results;
  if(!result?.rows?.length)return `<h3>Results</h3><p>${esc(guide.resultsNote||'A comparable results snapshot is not available for this format yet.')}</p><p class="guide-caption">The archetype guide remains available in Refresher.</p>`;
  const relevant=result.rows.filter(row=>row.games>=500);
  const ranked=[...relevant].sort((a,b)=>b.wins/b.games-a.wins/a.games);
  const names=new Map(guide.archetypes.map(a=>[[...a.colors].sort().join(''),a.name]));
  const label=row=>names.get([...row.colors].sort().join(''));
  return `<h3>Observed color results</h3>
    <p class="guide-caption">17Lands · ${esc(result.formatLabel)} · all users · ${result.colorCount===3?'three':'two'} main colors · no splashes</p>
    ${ranked.length?`<p class="guide-results-lead"><strong>${esc(colorNames(ranked[0].colors))}</strong> has the highest observed win rate in this sample among combinations with at least 500 games.</p>`:''}
    <div class="guide-table-wrap"><table class="guide-results-table"><caption>Game win rates · all-time snapshot retrieved ${esc(date(result.retrievedAt))}</caption><thead><tr><th scope="col">Colors / theme</th><th scope="col">Win rate</th><th scope="col">Games</th></tr></thead><tbody>${[...result.rows].sort((a,b)=>(b.games>=500)-(a.games>=500)||b.wins/b.games-a.wins/a.games).map(row=>`<tr><th scope="row">${colorMark(row.colors)}<span>${esc(colorNames(row.colors))}${label(row)?`<small>${esc(label(row))}</small>`:''}</span></th><td>${row.games>=500?percent(row):'—'}</td><td>${count(row.games)}</td></tr>`).join('')}</tbody></table></div>
    ${result.baseline?.games?`<p class="guide-baseline">All ${result.colorCount===3?'three':'two'}-color decks without splashes <strong>${percent(result.baseline)}</strong><span>${count(result.baseline.games)} games · same sample</span></p>`:''}
    <p class="guide-caption">These are deck-color results, not confirmed archetype classifications. Win rates reflect the players and decks in the sample; use the same-sample baseline, not 50%. Combinations below 500 games show their count but no rate.</p>
    <p class="guide-caption">All-time data may include return events. A high rate is context, not a reason to force a color combination. <a href="${esc(safeLink(result.sourceUrl))}" target="_blank" rel="noopener noreferrer">Explore the 17Lands data ↗</a></p>`;
}

export function renderSetGuide(guide,{id=`set-guide-${guide.id}`}={}) {
  return `<div class="set-guide" data-guide-id="${esc(guide.id)}">
    <div class="guide-tabs" role="tablist" aria-label="Set guide sections" hidden><button type="button" role="tab" id="${esc(id)}-refresher-tab" aria-controls="${esc(id)}-refresher" aria-selected="true" tabindex="0">Refresher</button><button type="button" role="tab" id="${esc(id)}-results-tab" aria-controls="${esc(id)}-results" aria-selected="false" tabindex="-1">Results</button></div>
    <section class="guide-panel" id="${esc(id)}-refresher" role="tabpanel" aria-labelledby="${esc(id)}-refresher-tab">${renderRefresher(guide)}</section>
    <section class="guide-panel" id="${esc(id)}-results" role="tabpanel" aria-labelledby="${esc(id)}-results-tab">${renderResults(guide)}</section>
    <footer class="guide-sources"><span>Guide reviewed ${esc(date(guide.reviewedAt))}</span>${guide.sources.map(source=>`<a href="${esc(safeLink(source.url))}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a>`).join('')}</footer>
  </div>`;
}

export function bindGuidePanels(root,{results=false}={}) {
  const tabs=[...root.querySelectorAll('[role="tab"]')];
  if(tabs.length!==2)return;
  const panels=[...root.querySelectorAll('[role="tabpanel"]')];
  const select=(index,focus=false)=>{
    tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
    if(focus)tabs[index].focus();
  };
  root.querySelector('[role="tablist"]').hidden=false;
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>select(index));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();select(event.key==='Home'?0:event.key==='End'?1:1-index,true);
    });
  });
  select(results?1:0);
}

const cache=new Map();
export async function loadSetGuide(id) {
  const key=String(id||'').toLowerCase();
  if(!hasSetGuide(key))throw new Error('No guide is available for this set.');
  if(!cache.has(key))cache.set(key,fetch(new URL(`./sets/guides/data/${key}.json`,import.meta.url),{signal:AbortSignal.timeout(10000)}).then(async response=>{
    if(!response.ok)throw new Error('The set guide could not be loaded.');
    const guide=await response.json();
    if(guide.id!==key||!Array.isArray(guide.archetypes)||!Array.isArray(guide.notes)||!Array.isArray(guide.sources))throw new Error('The set guide is unavailable.');
    return guide;
  }).catch(error=>{cache.delete(key);throw error;}));
  return cache.get(key);
}

let installed=false,peek=null,peekAnchor=null,peekTimer,closeTimer,peekRevision=0,dialog=null;
export function dismissSetRefresher() {
  clearTimeout(peekTimer);clearTimeout(closeTimer);peekRevision++;
  peek?.remove();peek=null;peekAnchor=null;
}

export function installSetGuides() {
  if(installed)return;installed=true;
  if(!document.querySelector('[data-set-guide-styles]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./set-guides.css?v=2',import.meta.url).href;css.dataset.setGuideStyles='';document.head.append(css);
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-set-refresher]');
    if(trigger){event.preventDefault();void openSetGuide(trigger.dataset.setRefresher,trigger);}
  });
  document.addEventListener('pointerover',event=>{
    if(event.pointerType!=='mouse')return;
    const trigger=event.target.closest('[data-set-refresher]');
    if(peek?.contains(event.target)||(trigger&&trigger===peekAnchor)){clearTimeout(closeTimer);return;}
    if(!trigger)return;
    clearTimeout(peekTimer);peekTimer=setTimeout(()=>void showPeek(trigger),180);
  });
  document.addEventListener('pointerout',event=>{
    if(event.pointerType!=='mouse')return;
    if(event.target.closest('[data-set-refresher]')||peek?.contains(event.target)) {
      clearTimeout(peekTimer);
      if(peek?.contains(event.relatedTarget)||peekAnchor?.contains(event.relatedTarget))return;
      closeTimer=setTimeout(dismissSetRefresher,200);
    }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')dismissSetRefresher();});
  document.addEventListener('pointerdown',event=>{if(peek&&!peek.contains(event.target)&&!peekAnchor?.contains(event.target))dismissSetRefresher();});
  window.addEventListener('resize',dismissSetRefresher);
  window.addEventListener('scroll',event=>{if(peek&&!peek.contains(event.target))dismissSetRefresher();},true);
}

async function showPeek(anchor) {
  dismissSetRefresher();const revision=peekRevision;peekAnchor=anchor;
  try {
    const guide=await loadSetGuide(anchor.dataset.setRefresher);
    if(revision!==peekRevision||!anchor.isConnected||dialog?.open)return;
    peek=document.createElement('aside');peek.className='set-refresher-popover';peek.setAttribute('aria-label',`${guide.name} quick refresher`);
    peek.innerHTML=`<p class="eyebrow">Quick refresher</p><h2>${esc(guide.name)}</h2><ul class="guide-peek-archetypes">${guide.archetypes.map(a=>`<li>${colorMark(a.colors)}<span>${esc(a.name)}</span></li>`).join('')}</ul><p class="guide-caption">${esc(guide.notes[0])}</p><button type="button" class="button primary" data-set-refresher="${esc(guide.id)}">Open set guide</button>`;
    document.body.append(peek);
    const r=anchor.getBoundingClientRect(),width=Math.min(420,window.innerWidth-24);
    peek.style.width=`${width}px`;
    peek.style.left=`${Math.max(12,Math.min(r.left,window.innerWidth-width-12))}px`;
    peek.style.top=`${Math.max(12,Math.min(r.bottom+8,window.innerHeight-peek.offsetHeight-12))}px`;
  } catch {dismissSetRefresher();}
}

export async function openSetGuide(id,opener) {
  if(peek?.contains(opener))opener=peekAnchor;
  dismissSetRefresher();dialog?.close();
  const current=document.createElement('dialog');dialog=current;current.className='set-guide-dialog';current.setAttribute('aria-labelledby','set-guide-dialog-title');
  current.innerHTML=`<header class="set-guide-dialog-header"><div><p class="eyebrow">Set guide</p><h2 id="set-guide-dialog-title">${esc(String(id).toUpperCase())}</h2></div><button type="button" class="button secondary guide-close" aria-label="Close set guide">Close</button></header><div class="set-guide-dialog-body" aria-live="polite"><p>Loading set guide…</p></div>`;
  current.querySelector('.guide-close').addEventListener('click',()=>current.close());
  current.addEventListener('close',()=>{current.remove();if(dialog===current)dialog=null;if(opener?.isConnected)opener.focus({preventScroll:true});});
  current.addEventListener('click',event=>{if(event.target!==current)return;const r=current.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)current.close();});
  document.body.append(current);current.showModal();
  const render=async()=>{
    try {
      const guide=await loadSetGuide(id);if(!current.isConnected)return;
      current.querySelector('h2').textContent=guide.name;
      const body=current.querySelector('.set-guide-dialog-body');body.removeAttribute('aria-live');
      body.innerHTML=`${renderSetGuide(guide,{id:'set-guide-dialog'})}<p class="guide-page-link"><a href="${esc(setGuidePath(id))}" target="_blank" rel="noopener noreferrer">Open this guide in a new tab ↗</a></p>`;
      bindGuidePanels(body);
    } catch {
      if(!current.isConnected)return;
      current.querySelector('.set-guide-dialog-body').innerHTML=`<p role="alert">The set guide could not be loaded. Your run is still here.</p><button type="button" class="button secondary" data-guide-retry>Try again</button><p><a href="${esc(setGuidePath(id))}" target="_blank" rel="noopener noreferrer">Open the guide page ↗</a></p>`;
      current.querySelector('[data-guide-retry]').addEventListener('click',render,{once:true});
    }
  };
  await render();
}
