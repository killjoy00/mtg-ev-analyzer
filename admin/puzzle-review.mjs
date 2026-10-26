import {RATINGS,ARMS,isRating,ratedCount,summarizeReview} from './puzzle-review-results.mjs?v=20261026-puzzle-review-v2';

// Blinded owner review of puzzle selection. The review set is static and
// public card data; the arm key is fetched only after every puzzle is rated.
// Progress lives in this browser only, so results can be downloaded.
export const REVIEW_VERSION='puzzle-review-v2';
const SET_URL=new URL(`./puzzle-review/${REVIEW_VERSION}-set.json`,import.meta.url);
const KEY_URL=new URL(`./puzzle-review/${REVIEW_VERSION}-key.json`,import.meta.url);
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const cost=value=>String(value||'').replace(/[{}]/g,'');
const image=card=>/^https:\/\//.test(card.image_url||'')?`<img src="${esc(card.image_url)}" alt="${esc(card.name)}" loading="lazy">`:'';

export function storageKey(accountId) {return `pack1-admin-${REVIEW_VERSION}:${accountId||'admin'}`;}
export function emptyState() {return {ratings:{},revealed:{},index:0,results_viewed_at:null};}
export function loadState(storage,keyName) {
  try {
    const saved=JSON.parse(storage?.getItem(keyName)||'null');
    if(saved&&typeof saved==='object'&&saved.ratings&&typeof saved.ratings==='object')
      return {...emptyState(),...saved,ratings:saved.ratings,revealed:saved.revealed||{}};
  } catch {}
  return emptyState();
}
function saveState(storage,keyName,state) {
  try {storage.setItem(keyName,JSON.stringify(state));return true;} catch {return false;}
}

// Points a player would score for each card: trophy 100, others
// round(95 x support / strongest support), as in the live game.
export function cardScores(item) {
  const top=Math.max(...item.candidates.map(c=>Number(c.model_probability)||0));
  return Object.fromEntries(item.candidates.map(c=>[c.id,c.id===item.historical_pick_id?100:top>0?Math.round(95*Number(c.model_probability)/top):0]));
}

function puzzleMarkup(item,state,position,total) {
  const revealed=Boolean(state.revealed[item.item_id]),saved=state.ratings[item.item_id]||{};
  const scores=revealed?cardScores(item):{};
  const prior=item.prior_picks.length
    ?`<div class="review-prior">${item.prior_picks.map(card=>`<figure>${image(card)}<figcaption>${esc(card.name)} <small>${esc(cost(card.mana_cost))}</small></figcaption></figure>`).join('')}</div>`
    :'<p class="subpage-help">None. This is the first pick of the draft.</p>';
  const pack=item.candidates.map(card=>{
    const trophy=revealed&&card.id===item.historical_pick_id;
    return `<figure class="${trophy?'trophy':''}">${image(card)}<figcaption>${esc(card.name)} <small>${esc(cost(card.mana_cost))}</small>${revealed?`<span class="review-score">${trophy?'Trophy pick · 100':`Scores ${esc(scores[card.id])}`}</span>`:''}</figcaption></figure>`;
  }).join('');
  return `<section class="subpage-section review-puzzle" aria-labelledby="review-puzzle-heading">
    <h2 id="review-puzzle-heading">Puzzle ${position} of ${total}</h2>
    <p class="subpage-help">${esc(item.set_name)} · Pack 1, pick ${esc(item.pick_number)}</p>
    <h3>Earlier picks</h3>${prior}
    <h3>The pack</h3><div class="review-pack">${pack}</div>
    ${revealed?'<p class="subpage-help">Scores are what a player would earn: the trophy pick earns 100, others earn credit from model support.</p>'
      :'<p class="review-reveal"><button type="button" id="review-reveal">Show trophy pick</button> <span class="subpage-help">Decide what you would take, then reveal. Rating opens after the reveal, as it does for players.</span></p>'}
    <fieldset class="review-rating" ${revealed?'':'disabled'}><legend>How good is this puzzle?</legend>
      <div class="review-rating-options">${RATINGS.map(r=>`<button type="button" class="${saved.rating===r.id?'':'secondary'}" data-rating="${r.id}" aria-pressed="${saved.rating===r.id}"><strong>${esc(r.label)}</strong><small>${esc(r.help)}</small></button>`).join('')}</div>
      <label>Note (optional)<textarea id="review-note" maxlength="300" rows="2" placeholder="What made it good or bad?">${esc(saved.note||'')}</textarea></label>
    </fieldset>
    <div class="actions review-nav"><button type="button" class="secondary" id="review-prev" ${position===1?'disabled':''}>Previous</button><button type="button" class="secondary" id="review-next" ${position===total?'disabled':''}>Next</button></div>
  </section>`;
}

function progressMarkup(items,state) {
  const done=ratedCount(items,state.ratings),total=items.length;
  return `<section class="subpage-section" aria-labelledby="review-progress-heading">
    <h2 id="review-progress-heading">${done} of ${total} rated</h2>
    <div class="review-jump">${items.map((item,i)=>`<button type="button" class="${i===state.index?'':'secondary'} ${isRating(state.ratings[item.item_id]?.rating)?'rated':''}" data-jump="${i}" aria-label="Puzzle ${i+1}${isRating(state.ratings[item.item_id]?.rating)?', rated':''}" ${i===state.index?'aria-current="true"':''}>${i+1}</button>`).join('')}</div>
    ${done===total?'<p><button type="button" id="review-results">See results</button> <span class="subpage-help">This reveals which puzzles came from which selector. Ratings lock after that.</span></p>'
      :'<p class="subpage-help">Results unlock once all puzzles are rated.</p>'}
  </section>`;
}

const introMarkup=(total,pairs,probes)=>`<header class="subpage-heading"><p class="subpage-kicker">Selection research</p><h1>Puzzle review</h1>
  <p class="muted">Rate ${total} Pack One puzzles. ${pairs*2} of them are ${pairs} matched pairs: one puzzle drawn the way today’s Daily draws it and one by the proposed rule, from the same set and pick.${probes?` The other ${probes} test a separate land rule.`:''} They are shuffled, and you only see which is which after rating all of them.</p></header>
  <details class="subpage-section review-about"><summary>How this test works</summary>
  <p class="subpage-help"><strong>Today’s selector:</strong> any medium or hard puzzle at that pick, chosen at random.</p>
  <p class="subpage-help"><strong>Proposed rule:</strong> at least two credible options (35% or more of the leader’s model support); from pick 4 on, the trophy pick must have made the trophy deck’s main deck; from pick 5 on, the trophy pick is not a land; then the top quarter by the strongest credible card’s win rate, chosen at random.</p>
  ${probes?`<p class="subpage-help"><strong>Land test:</strong> ${probes} late picks (5–8) where the trophy pick is a land taken over a card in the top 20% of its set by win rate that strong players also rated. They show whether a land over a strong card makes a good late puzzle.</p>`:''}
  <p class="subpage-help"><strong>Pass:</strong> the proposed rule has at most half as many Dull or Broken puzzles, and loses at most ${Math.floor(pairs/4)} of the ${pairs} pairs.${probes?` Allowing late lands taken over a strong card is worth adding only if at least ${Math.ceil(0.75*probes)} of the ${probes} land puzzles are rated Interesting or Fine.`:''} These criteria were fixed before any rating.</p>
  <p class="subpage-help">Puzzles come from the checked-in corpus sample for The Hobbit, Marvel Super Heroes, Secrets of Strixhaven, Bloomburrow and Lorwyn Eclipsed, with a fixed random seed. None reuse a draft from the first review. Progress is saved in this browser only.</p></details>`;

function landProbeMarkup(probe,key,state,itemsById) {
  if(!probe)return '';
  const label=id=>RATINGS.find(r=>r.id===id)?.label||id;
  const land=row=>{const item=itemsById.get(row.item);return item?.candidates.find(c=>c.id===item.historical_pick_id)?.name||'Unknown';};
  return `<h3>Land test</h3>
    <ul class="review-criteria"><li class="${probe.pass?'pass':'fail'}">Late land answers taken over a strong card, rated Interesting or Fine: ${probe.good} of ${probe.rows.length}. Needs ${probe.needed} or more.</li></ul>
    <p class="subpage-help">${probe.pass?'Late land answers could be allowed when the land was taken over a strong card.':'Keep the simpler rule: no land answers from pick 5 on.'}</p>
    <div class="scroll"><table class="review-pairs"><thead><tr><th>Puzzle</th><th>Rating</th><th>Land taken over</th></tr></thead><tbody>${probe.rows.map(row=>`<tr><th>${esc(row.set_id.toUpperCase())} P1P${esc(row.pick_number)}</th>
      <td><strong>${esc(label(row.rating))}</strong>${state.ratings[row.item]?.note?`<small>Note: ${esc(state.ratings[row.item].note)}</small>`:''}</td>
      <td>${esc(land(row))}<small>over ${key.items[row.item].passed_over.map(c=>`${esc(c.name)} (+${esc(c.gih_points)})`).join(', ')}</small></td></tr>`).join('')}</tbody></table></div>`;
}

function resultsMarkup(summary,key,state,itemsById) {
  const arms=['current','proposed'];
  const label=id=>RATINGS.find(r=>r.id===id)?.label||id;
  const option=(item)=>`<small>${esc(item.band)} · strongest credible card ${item.stakes_gih_points==null?'unknown':`${item.stakes_gih_points>0?'+':''}${esc(item.stakes_gih_points)} pts`} · trophy pick ${item.trophy_in_main_deck?'made':'missed'} the main deck${item.trophy_is_land?' · land answer':''} · ${esc(item.kind)}</small><small>${item.credible.map(c=>`${esc(c.name)} (${c.gih_points==null?'?':(c.gih_points>0?'+':'')+esc(c.gih_points)})`).join(', ')}</small>`;
  const winner={proposed:'Proposed better',current:'Today better',tie:'Tie'};
  const {fewer_bad:bad,losses}=summary.criteria;
  return `<section class="subpage-section review-results" aria-labelledby="review-results-heading">
    <h2 id="review-results-heading">${summary.pass?'The proposed rule passes':'The proposed rule does not pass'}</h2>
    <ul class="review-criteria">
      <li class="${bad.pass?'pass':'fail'}">Dull or Broken: proposed ${bad.proposed}, today ${bad.current}. Needs ${Math.floor(bad.current/2)} or fewer.</li>
      <li class="${losses.pass?'pass':'fail'}">Pairs where today’s puzzle rated higher: ${losses.losses} of ${summary.pairs.length}. Needs ${losses.allowed} or fewer.</li>
    </ul>
    ${summary.baseline_clean?'<p class="note">Today’s selector produced no Dull or Broken puzzles in this sample, so the first check cannot show an improvement.</p>':''}
    <p class="subpage-help">Proposed better in ${summary.wins.proposed} pairs, today better in ${summary.wins.current}, ties ${summary.wins.ties}. Strength is smoothed game-in-hand win rate minus the set average, in percentage points.</p>
    <div class="scroll"><table><thead><tr><th>Selector</th>${RATINGS.map(r=>`<th>${esc(r.label)}</th>`).join('')}</tr></thead><tbody>${arms.map(arm=>`<tr><th>${esc(ARMS[arm])}</th>${RATINGS.map(r=>`<td>${summary.arms[arm][r.id]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <h3>Pairs</h3>
    <div class="scroll"><table class="review-pairs"><thead><tr><th>Pair</th><th>Today’s selector</th><th>Proposed rule</th><th>Result</th></tr></thead><tbody>${summary.pairs.map(p=>`<tr><th>${esc(p.set_id.toUpperCase())} P1P${esc(p.pick_number)}</th>
      <td><strong>${esc(label(p.current_rating))}</strong>${option(key.items[p.current])}${state.ratings[p.current]?.note?`<small>Note: ${esc(state.ratings[p.current].note)}</small>`:''}</td>
      <td><strong>${esc(label(p.proposed_rating))}</strong>${option(key.items[p.proposed])}${state.ratings[p.proposed]?.note?`<small>Note: ${esc(state.ratings[p.proposed].note)}</small>`:''}</td>
      <td>${winner[p.winner]}</td></tr>`).join('')}</tbody></table></div>
    ${landProbeMarkup(summary.land_probe,key,state,itemsById)}
    <div class="actions"><button type="button" id="review-download">Download results</button><button type="button" class="secondary" id="review-reset">Start a new review</button></div>
  </section>`;
}

// The key's own `rating` is the support-ratio difficulty; keep it under its
// own name so it never replaces the rater's rating.
const exportItem=(key,id,rating)=>{const {rating:difficulty,...rest}=key.items[id];return {rating,difficulty_rating:difficulty,...rest};};
export function resultsExport(state,summary,key) {
  return {version:REVIEW_VERSION,exported_at:new Date().toISOString(),seed:key.seed,rule:key.rule,
    ratings:Object.fromEntries(Object.entries(state.ratings).map(([id,r])=>[id,{rating:r.rating,note:r.note||''}])),
    summary:{pass:summary.pass,criteria:summary.criteria,arms:summary.arms,wins:summary.wins,baseline_clean:summary.baseline_clean,
      ...(summary.land_probe?{land_probe:{good:summary.land_probe.good,needed:summary.land_probe.needed,pass:summary.land_probe.pass}}:{})},
    pairs:summary.pairs.map(p=>({pair_id:p.pair_id,set_id:p.set_id,pick_number:p.pick_number,current:exportItem(key,p.current,p.current_rating),
      proposed:exportItem(key,p.proposed,p.proposed_rating),winner:p.winner})),
    ...(summary.land_probe?{land_probe:summary.land_probe.rows.map(r=>({probe_id:r.probe_id,set_id:r.set_id,pick_number:r.pick_number,...exportItem(key,r.item,r.rating)}))}:{})};
}

export async function renderPuzzleReview(root,{accountId=null,storage=globalThis.localStorage,fetcher=globalThis.fetch}={}) {
  const keyName=storageKey(accountId);
  const response=await fetcher(SET_URL,{cache:'no-store'});
  if(!response.ok)throw Error('The puzzle review set could not be loaded.');
  const reviewSet=await response.json();
  if(reviewSet.version!==REVIEW_VERSION||!Array.isArray(reviewSet.items)||!reviewSet.items.length)throw Error('The puzzle review set is not the expected version.');
  const items=reviewSet.items,state=loadState(storage,keyName),itemsById=new Map(items.map(item=>[item.item_id,item]));
  state.index=Math.min(Math.max(0,Number(state.index)||0),items.length-1);
  let saving=saveState(storage,keyName,state),key=null;
  const persist=()=>{saving=saveState(storage,keyName,state);};
  const probeCount=Number(reviewSet.probes)||0,pairCount=Number(reviewSet.pairs)||(items.length-probeCount)/2;
  async function loadKey() {
    if(key)return key;
    const r=await fetcher(KEY_URL,{cache:'no-store'});
    if(!r.ok)throw Error('The review key could not be loaded.');
    const data=await r.json();
    if(data.version!==REVIEW_VERSION||items.some(item=>!data.items?.[item.item_id]))throw Error('The review key does not match this review set.');
    return key=data;
  }
  async function draw() {
    const storageNote=saving?'':'<p class="note" role="alert">This browser is not saving progress. Finish in one sitting, then download the results.</p>';
    if(state.results_viewed_at) {
      root.innerHTML=`<section class="puzzle-review">${introMarkup(items.length,pairCount,probeCount)}${storageNote}<p role="status">Loading results…</p></section>`;
      let summary;
      try {key=await loadKey();summary=summarizeReview(key,state.ratings);}
      catch(error) {root.querySelector('[role="status"]').textContent=error.message;return;}
      if(!summary.complete){state.results_viewed_at=null;persist();return draw();}
      root.innerHTML=`<section class="puzzle-review">${introMarkup(items.length,pairCount,probeCount)}${storageNote}${resultsMarkup(summary,key,state,itemsById)}</section>`;
      root.querySelector('#review-download').onclick=()=>{
        const blob=new Blob([JSON.stringify(resultsExport(state,summary,key),null,1)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`pack-one-${REVIEW_VERSION}-results.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      };
      root.querySelector('#review-reset').onclick=()=>{
        if(!confirm('Clear every rating and start a new review? Download the results first if you want to keep them.'))return;
        Object.assign(state,emptyState());persist();void draw();
      };
      return;
    }
    const item=items[state.index];
    root.innerHTML=`<section class="puzzle-review">${introMarkup(items.length,pairCount,probeCount)}${storageNote}${progressMarkup(items,state)}${puzzleMarkup(item,state,state.index+1,items.length)}<p id="review-status" role="status" aria-live="polite"></p></section>`;
    const go=index=>{state.index=index;persist();void draw();root.querySelector('#review-puzzle-heading')?.scrollIntoView?.({block:'start'});};
    root.querySelectorAll('[data-jump]').forEach(button=>button.onclick=()=>go(Number(button.dataset.jump)));
    root.querySelector('#review-prev').onclick=()=>go(state.index-1);
    root.querySelector('#review-next').onclick=()=>go(state.index+1);
    const reveal=root.querySelector('#review-reveal');
    if(reveal)reveal.onclick=()=>{state.revealed[item.item_id]=true;persist();void draw();};
    const note=root.querySelector('#review-note');
    note.onchange=()=>{state.ratings[item.item_id]={...(state.ratings[item.item_id]||{}),note:note.value.slice(0,300)};persist();};
    root.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>{
      state.ratings[item.item_id]={...(state.ratings[item.item_id]||{}),rating:button.dataset.rating,note:note.value.slice(0,300),at:new Date().toISOString()};
      const next=items.findIndex((x,i)=>i>state.index&&!isRating(state.ratings[x.item_id]?.rating));
      const firstOpen=items.findIndex(x=>!isRating(state.ratings[x.item_id]?.rating));
      if(next>=0)state.index=next;else if(firstOpen>=0)state.index=firstOpen;
      persist();void draw();
    });
    const results=root.querySelector('#review-results');
    if(results)results.onclick=async()=>{
      results.disabled=true;
      try {await loadKey();state.results_viewed_at=new Date().toISOString();persist();await draw();}
      catch(error){results.disabled=false;root.querySelector('#review-status').textContent=error.message;}
    };
  }
  await draw();
}
