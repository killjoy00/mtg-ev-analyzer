import { ensurePackSession } from './growth-api.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { shareDraftRunCard } from './share-cards.mjs';
import { trackEvent } from './retention-events.mjs';

const esc = value => String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const base = () => String(window.PACK1_API?.draftRunUrl||'').replace(/\/$/,'');
let run=null,selection=null,review=null,busy=false;
let environment=new URLSearchParams(location.search).get('set')==='powered-cube'?'powered-cube':'mixed';
const cube=()=> (run?.environment||environment)==='powered-cube';
const title=()=>cube()?'Powered Cube Run':'Draft Run';
const gameUrl=(params='')=>`?game=draft-run${cube()?'&set=powered-cube':''}${params?'&'+params:''}`;
const setName=id=>id==='powered-cube'?'Powered Cube':id.toUpperCase();
const app=()=>document.querySelector('#app');
function styles() {
  if(document.querySelector('[data-draft-run-style]')) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./draft-run.css';link.dataset.draftRunStyle='1';document.head.appendChild(link);
}
async function api(path,body,auth=true) {
  const headers={'content-type':'application/json'};
  if(auth) headers.authorization=`Bearer ${await ensurePackSession()}`;
  const r=await fetch(base()+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok) throw new Error(data.error||'Could not reach the game. Try again.');return data;
}
function image(card,extra='') {
  const url=/^https:\/\//.test(card.image_url||'')?card.image_url:'';
  return url?`<img src="${esc(url)}" alt="${esc(card.name)}" decoding="async" ${extra}>`:`<span class="run-card-fallback">${esc(card.name)}</span>`;
}
function steps() {
  return `<ol class="run-steps" aria-label="Run progress">${Array.from({length:10},(_,i)=>`<li class="${run.answers[i]?'done':i===run.answers.length?'current':''}" ${i===run.answers.length?'aria-current="step"':''}>${run.answers[i]?run.answers[i].score:i+1}</li>`).join('')}</ol>`;
}
function pool(p) {
  if(!p.prior_picks.length) return '<p class="run-context-empty">Pack 1, pick 1. A fresh start.</p>';
  const cardLabel=`${p.prior_picks.length} card${p.prior_picks.length===1?'':'s'} · in pick order`;
  return `<section class="run-pool" aria-label="Original drafter’s earlier picks"><h2>Their earlier picks <small>${cardLabel}</small></h2><p>Choose for this drafter’s pool.</p><div class="run-pool-cards">${p.prior_picks.map((c,i)=>`<button type="button" data-zoom-prior="${i}" aria-label="View previous pick ${i+1}: ${esc(c.name)}">${image(c)}<span>${i+1}. ${esc(c.name)}</span></button>`).join('')}</div></section>`;
}
function cardGrid(p,answer=null) {
  return `<div class="run-cards">${p.candidates.map(c=>`<article class="run-card ${selection===c.id?'selected':''} ${answer?.historicalId===c.id?'trophy-pick':''}"><button class="run-card-select" type="button" data-pick="${esc(c.id)}" aria-label="Pick ${esc(c.name)}" aria-pressed="${selection===c.id}" ${answer?'disabled':''}>${image(c)}<span>${esc(c.name)}</span></button><button class="run-zoom" type="button" data-zoom="${esc(c.id)}" aria-label="Enlarge ${esc(c.name)}">Enlarge</button>${answer?`<span class="run-card-score">${answer.historicalId===c.id?'Trophy pick · ':answer.selectedId===c.id?'Your pick · ':''}${answer.ranking.find(r=>r.id===c.id)?.score??0} pts</span>`:''}</article>`).join('')}</div>`;
}
function render() {
  const answer=review==null?null:run.answers[review];
  if(run.complete&&!answer) {renderResult();return;}
  const p=answer?.puzzle||run.current;
  document.body.classList.add('is-game');
  app().innerHTML=`<section class="draft-run-page"><header class="run-heading"><div><p class="eyebrow">${run.day?'Daily ':''}${title()} · ${run.day||'Practice'}</p><h1>${esc(setName(p.set_id))} <span>Pack 1 · Pick ${p.pick_number}</span></h1></div><a class="text-button" href="./">Leave run</a></header>${steps()}
    ${run.comparison?`<aside class="run-friend">${esc(run.comparison.name)} scored <strong>${run.comparison.score}</strong>. ${run.comparison.exact?'You’re playing the same ten packs.':'Packs changed — this result counts as practice.'}</aside>`:''}
    ${pool(p)}
    ${answer?`<section class="run-feedback" aria-live="polite"><strong>${answer.score}<small>/100</small></strong><div><h2>${answer.historicalMatch?'You matched the trophy drafter.':'The trophy drafter took '+esc(answer.historicalName)+'.'}</h2><p>${answer.historicalMatch?'Full points.':`You chose ${esc(answer.selectedName)}. ${answer.score>=85?'A strongly supported alternative.':answer.score>=60?'A plausible alternative.':'The model found less support for this choice.'}`}</p></div><button class="button primary" id="run-next">${run.complete?'See result':'Next pick'}</button></section>`:
    `<div class="run-tools"><p>Pick ${run.round} of 10</p><div>${cube()?'':`<button class="button secondary" data-reroll="set" ${!run.rerolls.set?'disabled':''}>New set · ${run.rerolls.set}</button>`}<button class="button secondary" data-reroll="pack" ${!run.rerolls.pack?'disabled':''}>New pack · ${run.rerolls.pack}</button></div>${run.comparison?.exact?'<small>Using a reroll continues as practice rather than a head-to-head result.</small>':''}</div>`}
    ${cardGrid(p,answer)}
    ${answer?'<p class="run-note">Trophy pick: 100. Other choices earn up to 95 from contextual strong-player support. Matching the trophy drafter is the goal of this game.</p>':`<div class="run-lock"><span id="run-selection-label">Choose a card</span><button class="button primary" id="run-lock" disabled>Lock pick</button></div>`}
    <p class="run-error" id="run-error" role="alert"></p></section>`;
  bind(p,answer);
}
function zoom(card) {
  const dialog=document.createElement('dialog');dialog.className='run-card-dialog';dialog.innerHTML=`<button class="button secondary" autofocus>Close</button>${image(card)}<p>${esc(card.name)}</p>`;
  document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
function bind(p,answer) {
  app().querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>zoom(p.candidates.find(c=>c.id===b.dataset.zoom)));
  app().querySelectorAll('[data-zoom-prior]').forEach(b=>b.onclick=()=>zoom(p.prior_picks[Number(b.dataset.zoomPrior)]));
  if(answer) {document.querySelector('#run-next').onclick=()=>{review=null;selection=null;render();window.scrollTo({top:0,behavior:'instant'});};return;}
  app().querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    if(busy)return;selection=b.dataset.pick;
    app().querySelectorAll('[data-pick]').forEach(c=>{c.setAttribute('aria-pressed',String(c.dataset.pick===selection));c.closest('.run-card').classList.toggle('selected',c.dataset.pick===selection);});
    document.querySelector('#run-selection-label').textContent=p.candidates.find(c=>c.id===selection).name;document.querySelector('#run-lock').disabled=false;
  });
  app().querySelectorAll('[data-reroll]').forEach(b=>b.onclick=()=>mutate('reroll',{type:b.dataset.reroll}));
  document.querySelector('#run-lock').onclick=()=>mutate('pick',{cardId:selection});
}
async function mutate(action,body) {
  if(busy)return;busy=true;
  app().querySelectorAll('button:not(.run-zoom)').forEach(b=>b.disabled=true);
  const round=run.answers.length;
  try {
    run=await api(`/v1/runs/${run.id}/${action}`,{...body,revision:run.revision,round,puzzleId:run.current.puzzle_id});
    review=action==='pick'?round:null;selection=null;render();
    if(action==='reroll') trackEvent('draft_run_rerolled',{type:body.type,round:round+1,daily:Boolean(run.day)});
    if(run.complete) document.dispatchEvent(new CustomEvent('pack1:result-completed',{detail:{id:`draft-run:${run.id}`,score:run.score,mode:'draft_run',set_id:run.environment,daily:Boolean(run.day)}}));
    window.scrollTo({top:0,behavior:'instant'});
  } catch(e) {
    // Recover authoritative state after a lost response or a second-tab write.
    const message=e.message;
    try {run=await api(`/v1/runs/${run.id}`);review=run.answers.length>round?round:null;selection=null;render();} catch {render();}
    document.querySelector('#run-error').textContent=message;
  } finally {busy=false;}
}
function renderResult() {
  document.body.classList.remove('is-game');
  const matches=run.answers.filter(a=>a.historicalMatch).length;
  app().innerHTML=`<section class="run-result-page"><p class="eyebrow">${run.day?'Daily ':''}${title()} complete</p><h1>Your ${cube()?'Cube Run':'Draft Run'}.</h1><div class="run-final-score"><strong>${run.score}</strong><span>/100<br>${matches} trophy picks matched</span></div>
    ${run.standing?`<p class="run-standing">#${run.standing.rank} of ${run.standing.total} today${run.standing.percentile?` · Top ${run.standing.percentile}%`:''}. ${run.standing.final?'Final result.':'The board closes at midnight Eastern.'}</p>`:''}
    ${run.comparison?`<p class="run-friend">${run.comparison.exact?`${run.score>run.comparison.score?'You win':run.score===run.comparison.score?'A tie':'Your friend wins'} · ${run.score}–${run.comparison.score} against ${esc(run.comparison.name)}`:'Different packs played; no challenge win or loss recorded.'}</p>`:''}
    <div class="run-result-actions"><a class="button primary" href="${gameUrl()}">Play another run</a><button class="button secondary" id="run-challenge">Challenge a friend</button><button class="text-button" id="run-share">Share result</button><a class="text-button" href="${gameUrl('board=daily')}">Leaderboard</a></div>
    <aside id="post-game-progress" class="post-game-progress" data-result-id="draft-run:${run.id}"></aside>
    <h2>Your ten picks</h2><ol class="run-review-list">${run.answers.map((a,i)=>`<li><button data-review="${i}"><span>${i+1}</span><div><strong>${esc(setName(a.puzzle.set_id))} · Pick ${a.pickNumber}</strong><small>${esc(a.selectedName)}${a.historicalMatch?' · Trophy match':''}</small></div><b>${a.score}</b></button></li>`).join('')}</ol>
    <p class="run-note">Your final score is the average of ten decisions. Trophy picks earn 100; alternatives earn up to 95 from held-out strong-player support.</p><p id="run-share-status" role="status"></p><p id="run-error" role="alert"></p></section>`;
  app().querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{review=Number(b.dataset.review);render();window.scrollTo({top:0,behavior:'instant'});});
  document.querySelector('#run-share').onclick=()=>shareResult(false);
  document.querySelector('#run-challenge').onclick=()=>shareResult(true);
  document.dispatchEvent(new CustomEvent('pack1:result-visible',{detail:{id:`draft-run:${run.id}`,score:run.score,mode:'draft_run',set_id:run.environment,daily:Boolean(run.day)}}));
}
async function shareResult(challenge) {
  const button=document.querySelector(challenge?'#run-challenge':'#run-share');button.disabled=true;
  try {
    const share=await api(`/v1/runs/${run.id}/share`,{});
    const url=`${location.origin}${location.pathname}${gameUrl('challenge='+share.id)}`;
    trackEvent('share_click',{surface:challenge?'draft_run_challenge':'draft_run_result'});
    const result=await shareDraftRunCard(run,url,{challenge});
    const status=document.querySelector('#run-share-status');
    if(result.failed) {status.textContent='Copy this link: ';const a=document.createElement('a');a.href=url;a.textContent=url;status.append(a);}
    else if(!result.cancelled) {status.textContent=result.method==='copy_fallback'?'Challenge link copied.':'Ready to share.';trackEvent(challenge?'challenge_created':'daily_result_shared',{mode:'draft_run',method:result.method});}
  } catch(e) {document.querySelector('#run-share-status').textContent=e.message;}
  finally {button.disabled=false;}
}
async function showBoard(period='daily') {
  app().innerHTML='<section class="message-card"><h1>Loading the board…</h1></section>';
  const data=await api(`/v1/leaderboard?period=${encodeURIComponent(period)}&environment=${environment}`,undefined,false);
  document.body.classList.remove('is-game');
  app().innerHTML=`<section class="run-board"><p class="eyebrow">${title()}</p><h1>The leaderboard</h1><nav aria-label="Leaderboard period">${[['daily','Today'],['week','This week'],['month','This month'],['all','All time']].map(([id,name])=>`<a class="${period===id?'active':''}" href="${gameUrl('board='+id)}">${name}</a>`).join('')}</nav><p>${period==='daily'?'First attempts on today’s ten decisions.':'Average of first-attempt Daily scores, with days played shown alongside.'}</p>${data.rows.length?`<ol>${data.rows.map(r=>`<li><b>${r.rank}</b>${r.profile_key?`<a href="?profile=${esc(r.profile_key)}">${esc(r.display_name)}</a>`:`<span>${esc(r.display_name)}</span>`}<small>${r.days} ${r.days===1?'day':'days'}</small><strong>${r.score}</strong></li>`).join('')}</ol>`:`<p class="run-empty">A fresh board. Finish today’s ${title()} to set the score to beat.</p>`}<a class="button primary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a><p><a href="?legacy-board=1">Top 3, Full Pack & Cube boards</a></p></section>`;
  trackEvent('leaderboard_view',{mode:'draft_run',set_id:environment,period});
}
async function launch(options={}) {
  app().innerHTML='<section class="message-card"><h1>Finding ten good decisions…</h1></section>';
  run=options.id?await api(`/v1/runs/${options.id}`):await api('/v1/runs',{daily:options.daily===true,challenge:options.challenge,environment});
  environment=run.environment||environment;
  const url=new URL(location.href);if(cube())url.searchParams.set('set','powered-cube');else url.searchParams.delete('set');url.searchParams.delete('challenge');url.searchParams.set('run',run.id);history.replaceState({},'',url);
  selection=null;review=null;render();
}
// Raw exception text ("Failed to fetch") is developer output, not an
// explanation. Say what happened, and offer the action that actually retries
// the thing that failed.
function failureMessage(error) {
  const raw=String(error?.message||'');
  if(/fetch|network|load failed|connection/i.test(raw)) return 'We couldn’t reach Pack One’s servers. This is usually a brief hiccup or a dropped connection.';
  if(/^5\d\d|server|unavailable|temporarily/i.test(raw)) return 'Pack One’s servers are busy right now. Give it a moment and try again.';
  return 'Something went wrong on our side while loading this page.';
}

function renderLoadFailure(error,isBoard) {
  console.warn('Draft Run page failed to load',error?.message);
  const retry=`<button class="button primary" type="button" data-run-retry="1">Try again</button>`;
  const secondary=isBoard
    ? `<a class="button secondary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a>`
    : `<a class="button secondary" href="${gameUrl()}">Start a fresh run</a>`;
  app().innerHTML=`<section class="message-card"><h1>${isBoard?'Couldn’t load the leaderboard.':'Couldn’t start that run.'}</h1><p>${esc(failureMessage(error))}</p><div class="button-row">${retry}${secondary}</div><p><a class="text-button" href="./">Back home</a></p></section>`;
  app().querySelector('[data-run-retry]').onclick=()=>location.reload();
}

export async function installDraftRunPage() {
  styles();document.querySelector('#brand-home').onclick=()=>location.href='./';
  document.querySelector('#daily-nav').onclick=()=>location.href=gameUrl('daily=1');
  document.querySelector('#leaderboard-nav').onclick=()=>location.href=gameUrl('board=daily');
  const params=new URLSearchParams(location.search);
  try {
    if(params.has('board')) {await showBoard(params.get('board'));return;}
    if(params.has('challenge')&&!params.has('run')) {
      const info=await api('/v1/challenges/'+encodeURIComponent(params.get('challenge')),undefined,false);
      environment=info.environment||'mixed';
      app().innerHTML=`<section class="run-invite"><p class="eyebrow">A friend’s ${title()}</p><h1>Can you beat ${info.score}?</h1><p>${esc(info.name)} sent you ten real decisions from trophy drafts. You’ll see the same packs and the same earlier picks.</p><button class="button primary" id="accept-run-challenge">Play this challenge</button><p>No account needed. About five minutes.</p><p id="run-error" role="alert"></p></section>`;
      trackEvent('challenge_open',{mode:'draft_run',kind:'stored'});
      document.querySelector('#accept-run-challenge').onclick=async()=>{try{trackEvent('challenge_start',{mode:'draft_run'});await launch({challenge:info.id});}catch(e){console.warn('Draft Run challenge failed to start',e?.message);app().innerHTML=`<section class="message-card"><h1>Couldn’t start that challenge.</h1><p>${esc(failureMessage(e))}</p><a class="button primary" href="${esc(location.href)}">Try again</a></section>`;}};
    } else await launch({id:params.get('run'),daily:params.has('daily')});
  } catch(e) {renderLoadFailure(e,params.has('board'));}
}
export function installDraftRunHome() {
  styles();
  // Start the read-only corpus warmup while the player reads the landing page.
  if(base())void api('/health',undefined,false).catch(()=>{});
  if(!new URLSearchParams(location.search).has('legacy-board')) {
    for(const [id,url] of [['daily-nav','?game=draft-run&daily=1'],['leaderboard-nav','?game=draft-run&board=daily']])
      document.getElementById(id)?.addEventListener('click',e=>{e.stopImmediatePropagation();location.href=url;},true);
  }
  onAppRender(()=>{
    const intro=document.querySelector('.home-intro');if(!intro||document.querySelector('.draft-run-feature'))return;
    const copy=intro.querySelector('p:last-child');if(copy)copy.textContent='Ten tough choices from trophy drafts. Read the drafter’s pool, make your pick, and see how you did.';
    intro.insertAdjacentHTML('afterend',`<section class="draft-run-feature"><div><p class="eyebrow">The Daily Draft Run</p><h2>Ten picks.<br> Your call.</h2><p>Different sets. Real trophy drafts. One set reroll and one pack reroll when you need them.</p></div><div class="draft-run-feature-actions"><a class="button primary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a><a class="button secondary" href="${gameUrl()}">Practice a Draft Run</a><a class="text-button" href="${gameUrl('board=daily')}">See the Draft Run board</a><small>Free to play · No account needed</small></div></section>`);
  });
  if(new URLSearchParams(location.search).has('legacy-board')) queueMicrotask(()=>document.querySelector('#leaderboard-nav')?.click());
}
