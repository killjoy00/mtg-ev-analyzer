import {draftRunLength} from './draft-run-format.mjs';
import { accountCsrfToken, ensurePackSession, firstPartyAuthEnabled, hasAccountSession, loadDailyStatus, storedAccountToken } from './growth-api.mjs';
import { shareDraftRunCard } from './share-cards.mjs';
import { trackEvent } from './retention-events.mjs';
import {decisionClock} from './decision-clock.mjs';
import { sortPackByRarity } from './replay-data.mjs';
import { escapeHtml as esc } from './html.mjs';
import { consensusFeedback } from './draft-run-feedback.mjs';
import { tcgplayerUrl } from './tcgplayer.mjs';

const base = () => String(window.PACK1_API?.draftRunUrl||'').replace(/\/$/,'');
let run=null,selection=null,review=null,busy=false,dailyValidationConfirmation=null;
const clock=decisionClock();let viewPromise=Promise.resolve(),viewKey=null;
document.addEventListener('visibilitychange',()=>{if(document.hidden)clock.pause();else if(run?.current&&review==null&&!busy)recordView(true);});
function recordView(touch=false) {
  if(document.hidden)return;
  const key=`${run.id}:${run.revision}`,viewId=clock.show(key);
  if(viewKey!==key||touch){viewKey=key;viewPromise=api(`/v1/runs/${run.id}/view`,{revision:run.revision,puzzleId:run.current.puzzle_id,viewId}).catch(()=>null);}
}
let environment=['powered-cube','latest'].includes(new URLSearchParams(location.search).get('set'))?new URLSearchParams(location.search).get('set'):'mixed';
const runLength=()=>draftRunLength(run);
const cube=()=> (run?.environment||environment)==='powered-cube';
const title=()=>cube()?'Powered Cube Run':environment==='latest'?'Latest Set Run':'Draft Run';
const gameUrl=(params='')=>`?game=draft-run${environment!=='mixed'?'&set='+environment:''}${params?'&'+params:''}`;
const boardUrl=(target,period='daily')=>`?game=draft-run${target!=='mixed'?'&set='+target:''}&board=${period}`;
let catalogNames = new Map();
const setName=id=>catalogNames.get(id) || (id==='powered-cube'?'Powered Cube':id.toUpperCase());
async function loadSetNames() {
  try {
    const response=await fetch('./data/set-display-names.json',{signal:AbortSignal.timeout(3000)});
    if(response.ok) catalogNames=new Map(Object.entries((await response.json()).names));
  } catch {} // Set codes remain a usable fallback when the catalog is unavailable.
}
const app=()=>document.querySelector('#app');
function styles() {
  if(document.querySelector('[data-draft-run-style]')) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./draft-run.css?v=2';link.dataset.draftRunStyle='1';document.head.appendChild(link);
}
async function api(path,body,auth=true) {
  const method=body===undefined?'GET':'POST',headers={'content-type':'application/json'};
  if(firstPartyAuthEnabled()) {
    if(auth)await ensurePackSession();
    const csrf=accountCsrfToken();if(method==='POST'&&csrf)headers['x-pack1-csrf']=csrf;
  } else if(auth) {
    headers.authorization=`Bearer ${await ensurePackSession()}`;
    const token=storedAccountToken();if(token)headers['x-pack1-auth-session']=token;
  }
  const r=await fetch(base()+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:firstPartyAuthEnabled()?'include':'omit',signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok) throw Object.assign(new Error(data.error||'Could not reach the game. Try again.'),{status:r.status,capability:data.capability});return data;
}
function image(card,extra='') {
  const url=/^https:\/\//.test(card.image_url||'')?card.image_url:'';
  return url?`<img src="${esc(url)}" alt="${esc(card.name)}" decoding="async" ${extra}>`:`<span class="run-card-fallback">${esc(card.name)}</span>`;
}
function steps() {
  return `<ol class="run-steps" aria-label="Run progress">${Array.from({length:runLength()},(_,i)=>`<li class="${run.answers[i]?'done':i===run.answers.length?'current':''}" aria-label="Round ${i+1}${run.answers[i]?`, ${run.answers[i].score} points`:''}" ${i===run.answers.length?'aria-current="step"':''}><span>${i+1}</span>${run.answers[i]?`<small>${run.answers[i].score} pts</small>`:''}</li>`).join('')}</ol>`;
}
function pool(p) {
  if(!p.prior_picks.length) return '';
  const cardLabel=`${p.prior_picks.length} card${p.prior_picks.length===1?'':'s'} · in pick order`;
  return `<section class="run-pool" aria-label="Original drafter’s earlier picks"><h2>Their earlier picks <small>${cardLabel}</small></h2><p>Choose for this drafter’s pool.</p><div class="run-pool-cards">${p.prior_picks.map((c,i)=>`<button type="button" data-zoom-prior="${i}" aria-label="View previous pick ${i+1}: ${esc(c.name)}">${image(c)}<span>${i+1}. ${esc(c.name)}</span></button>`).join('')}</div></section>`;
}
// The reveal names two cards, but in the grid below they sit wherever the pack
// put them — often a screen or more apart, and never both visible alongside the
// verdict. Put the pair in the panel itself so the comparison is one glance.
function revealComparison(p,answer) {
  const byId=new Map((p.candidates||[]).map(c=>[c.id,c]));
  const mine=byId.get(answer.selectedId),trophy=byId.get(answer.historicalId);
  if(!mine) return '';
  const cell=(card,label,cls)=>`<figure class="run-compare-card ${cls}"><span>${label}</span><button type="button" data-zoom="${esc(card.id)}" aria-label="Enlarge ${esc(card.name)}">${image(card)}</button><figcaption>${esc(card.name)}</figcaption><a class="run-card-shop" href="${esc(tcgplayerUrl(card.name))}" target="_blank" rel="sponsored noopener" data-tcgplayer-card="${esc(card.name)}" data-tcgplayer-surface="draft_run_reveal">Find on TCGplayer (affiliate link)</a></figure>`;
  if(answer.historicalMatch||!trophy||trophy.id===mine.id)
    return `<div class="run-compare is-match">${cell(mine,'Your pick · trophy pick','is-mine')}</div>`;
  return `<div class="run-compare">${cell(mine,'Your pick','is-mine')}${cell(trophy,'Trophy pick','is-trophy')}</div>`;
}
function cardGrid(p,answer=null) {
  const candidates=sortPackByRarity(p.candidates);
  return `<div class="run-cards">${candidates.map(c=>`<article class="run-card ${selection===c.id?'selected':''} ${answer?.historicalId===c.id?'trophy-pick':''}"><button class="run-card-select" type="button" data-pick="${esc(c.id)}" aria-label="Pick ${esc(c.name)}" aria-pressed="${selection===c.id}" ${answer?'disabled':''}>${image(c)}<span>${esc(c.name)}</span></button><button class="run-zoom" type="button" data-zoom="${esc(c.id)}" aria-label="Enlarge ${esc(c.name)}">Enlarge</button>${answer&&(answer.historicalId===c.id||answer.selectedId===c.id)?`<span class="run-card-outcome">${answer.historicalId===c.id?'Trophy pick':'Your pick'}</span>`:''}</article>`).join('')}</div>`;
}
function rankingStateMarkup(value=run) {
  if(!value?.day)return '';
  if(value.leaderboard_eligible)return `<p class="run-ranking-state" role="status">Ranked as ${esc(value.ranked_name||'your account')}</p>`;
  if(['username_taken','username_required'].includes(value.ranking_identity?.reason))
    return value.complete
      ? '<p class="run-ranking-state" role="alert"><strong>This Daily isn’t ranked yet.</strong> Choose a unique username to add this score to the leaderboard.</p>'
      : '<p class="run-ranking-state" role="alert"><strong>This Daily isn’t ranked yet.</strong> Your account needs a unique username. Choose one in My Pack One; you can add the completed score afterward.</p>';
  return '<p class="run-ranking-state" role="status">Playing as guest — sign in after the run to add this score to the leaderboard.</p>';
}
function render() {
  const answer=review==null?null:run.answers[review];
  if(answer||run.complete){clock.clear();viewKey=null;}
  if(run.complete&&!answer) {renderResult();return;}
  const p=answer?.puzzle||run.current;
  document.body.classList.add('is-game');
  app().innerHTML=`<section class="draft-run-page"><header class="run-heading"><div><p class="eyebrow">${run.day?'Daily ':''}${title()} · ${run.day||'Practice'}</p><h1>${esc(setName(p.set_id))} <span>Round ${answer?review+1:run.round}/${runLength()} · Pack 1 · Pick ${p.pick_number}${answer?' · revealed':''}</span></h1></div><a class="text-button" href="./">Leave run</a></header>${steps()}
    ${rankingStateMarkup(run)}
    ${run.comparison?`<aside class="run-friend">${esc(run.comparison.name)} scored <strong>${run.comparison.score}</strong>. ${run.comparison.exact?`You’re playing the same ${runLength()} packs.`:'Packs changed — this result counts as practice.'}</aside>`:''}
    ${answer?'':pool(p)}
    ${answer?`<section class="run-feedback" aria-live="polite"><strong>${answer.score}<small>/100</small></strong><div class="run-feedback-copy"><h2>${answer.historicalMatch?'You matched the trophy drafter.':'The trophy drafter took '+esc(answer.historicalName)+'.'}</h2><p>${answer.historicalMatch?'Full points.':`You chose ${esc(answer.selectedName)}. ${answer.score>=85?'A strongly supported alternative.':answer.score>=60?'A plausible alternative.':'The model found less support for this choice.'}`}</p>${answer.modelTargetDisagreement?'<p>The trophy drafter made an unusual choice relative to the model. Strong alternatives still receive their normal credit.</p>':''}</div>${revealComparison(p,answer)}${consensusFeedback(answer)}<div class="run-next-dock"><button class="button primary" id="run-next">${run.complete?'See result':'Next pick'}</button></div></section>`:
    ''}
    ${answer?`<details class="run-pack-review"><summary>Review the pack and earlier picks</summary>${pool(p)}${cardGrid(p,answer)}</details>`:cardGrid(p)}
    ${answer?'<p class="run-note">Trophy pick: 100. Other choices earn up to 95 from contextual strong-player support. Matching the trophy drafter is the goal of this game.</p>':`<div class="run-lock"><div class="run-lock-choice"><span id="run-selection-label">Choose a card</span><button class="button primary" id="run-lock" disabled>Lock pick</button></div>${run.day||run.comparison?.exact?'':`<div class="run-tools"><div>${cube()||run.custom_set_ids?.length?'':`<button class="button secondary" data-reroll="set" ${!run.rerolls.set||run.set_reroll_allowed===false?'disabled':''}>Reroll set · ${run.rerolls.set}</button>`}<button class="button secondary" data-reroll="pack" ${!run.rerolls.pack?'disabled':''}>Reroll pack · ${run.rerolls.pack}</button></div></div>`}</div>`}
    <p class="run-error" id="run-error" role="alert"></p></section>`;
  bind(p,answer);
  if(!answer) recordView();
}
function zoom(card) {
  const dialog=document.createElement('dialog');dialog.className='run-card-dialog';dialog.innerHTML=`<button class="button secondary" autofocus>Close</button>${image(card)}<p>${esc(card.name)}</p>`;
  document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
// The earlier-picks strip scrolls horizontally with no visible cue, so the
// cards past the right edge read as clipped rather than scrollable. Mark it
// only when it actually overflows.
let poolObserver=null;
function markPoolOverflow() {
  poolObserver?.disconnect();poolObserver=null;
  const strip=app().querySelector('.run-pool-cards');
  if(!strip) return;
  const update=()=>strip.classList.toggle('is-scrollable',strip.scrollWidth>strip.clientWidth+1);
  update();
  strip.addEventListener('scroll',()=>strip.classList.toggle('is-scrolled-end',strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-1),{passive:true});
  if(typeof ResizeObserver==='function') {poolObserver=new ResizeObserver(update);poolObserver.observe(strip);}
}
function bind(p,answer) {
  markPoolOverflow();
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
  clock.pause();const measurement=clock.sample();
  app().querySelectorAll('button:not(.run-zoom)').forEach(b=>b.disabled=true);
  const round=run.answers.length;
  try {
    // Measurement delivery must not hold a player's pick behind a slow request.
    await Promise.race([viewPromise,new Promise(resolve=>setTimeout(resolve,1500))]);
    run=await api(`/v1/runs/${run.id}/${action}`,{...body,...measurement,revision:run.revision,round,puzzleId:run.current.puzzle_id});
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
function resultRepeatAction() {
  if(run.day)return {href:'./',label:'Back to Dailies'};
  if(run.custom_set_ids?.length)return {href:'?game=draft-run&custom=1',label:'Choose Sets for Another Run'};
  return {href:gameUrl(),label:`Start Another ${title()}`};
}
function renderResult() {
  document.body.classList.remove('is-game');
  poolObserver?.disconnect();poolObserver=null;
  const matches=run.answers.filter(a=>a.historicalMatch).length;
  const repeat=resultRepeatAction();
  app().innerHTML=`<section class="run-result-page"><p class="eyebrow">${run.day?'Daily ':''}${title()} complete</p><h1>Your ${cube()?'Cube Run':'Draft Run'}.</h1><div class="run-final-score"><strong>${run.score}</strong><span>/100<br>${matches} trophy picks matched</span></div>
    <aside id="post-game-progress" class="post-game-progress" data-result-id="draft-run:${run.id}"></aside>
    ${run.standing?`<p class="run-standing">#${run.standing.rank} of ${run.standing.total} today${run.standing.percentile?` · Top ${run.standing.percentile}%`:''}. ${run.standing.final?'Final result.':'The board closes at midnight Eastern.'}</p>`:''}
    ${dailyValidationConfirmation?`<div class="run-validation-success" role="status" data-daily-validation-confirmation><strong>Score added to today's leaderboard</strong>${dailyValidationConfirmation.standing?`<span>#${dailyValidationConfirmation.standing.rank} of ${dailyValidationConfirmation.standing.total}${dailyValidationConfirmation.standing.percentile?` · Top ${dailyValidationConfirmation.standing.percentile}%`:''}</span>`:''}<a class="text-button" href="${gameUrl('board=daily')}">View leaderboard</a></div>`:''}
    ${rankingStateMarkup(run)}
    ${run.comparison?`<p class="run-friend">${run.comparison.exact?`You: ${run.score} · ${esc(run.comparison.name)}: ${run.comparison.score}`:'These scores came from different decisions.'}</p>`:''}
    <div class="run-result-actions"><a class="button primary" href="${repeat.href}">${repeat.label}</a><button class="button secondary" id="run-share">${run.day?'Share result':'Share this run and compare'}</button><a class="button secondary" href="${gameUrl('board=daily')}">Leaderboard</a><button class="button secondary" id="run-career">${run.day&&!run.leaderboard_eligible?(['username_taken','username_required'].includes(run.ranking_identity?.reason)?'Choose username to add score':'Sign in to add score'):'View your career'}</button></div>
    <h2>Your ${runLength()} picks</h2><ol class="run-review-list">${run.answers.map((a,i)=>`<li><button data-review="${i}"><span>${i+1}</span><div><strong>${esc(setName(a.puzzle.set_id))} · Pick ${a.pickNumber}</strong><small>${esc(a.selectedName)}${a.historicalMatch?' · Trophy match':''}</small></div><b>${a.score}</b></button></li>`).join('')}</ol>
    <p class="run-note">Your final score is the rounded average of ${runLength()} decisions. Trophy picks earn 100; alternatives earn up to 95 from held-out strong-player support.</p><p id="run-share-status" role="status"></p><p id="run-error" role="alert"></p></section>`;
  app().querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{review=Number(b.dataset.review);render();window.scrollTo({top:0,behavior:'instant'});});
  document.querySelector('#run-share').onclick=()=>shareResult();
  document.querySelector('#run-career').onclick=async()=>{if(run.day&&!run.leaderboard_eligible){(await import('./growth.mjs?v=6')).renderAccount({validateDailyRunId:run.id,source:'daily_result'});return;}document.querySelector('#account-nav')?.click();};
  document.dispatchEvent(new CustomEvent('pack1:result-visible',{detail:{id:`draft-run:${run.id}`,score:run.score,mode:'draft_run',set_id:run.environment,daily:Boolean(run.day)}}));
}
export async function returnToValidatedDaily(runId,{standing=null}={}) {
  styles();
  await loadSetNames();
  if(!run||run.id!==runId||!run.complete)run=await api(`/v1/runs/${runId}`);
  if(!run?.day||!run?.complete)throw new Error('Completed Daily result is unavailable.');
  environment=run.environment||environment;
  selection=null;review=null;
  run.leaderboard_eligible=true;
  run.standing=standing||null;
  dailyValidationConfirmation={standing:standing||null};
  renderResult();
  window.scrollTo({top:0,behavior:'instant'});
}

async function shareResult() {
  const button=document.querySelector('#run-share');button.disabled=true;
  try {
    const share=run.day?null:await api(`/v1/runs/${run.id}/share`,{});
    const url=`${location.origin}${location.pathname}${gameUrl(run.day?'daily=1&ref=result_share':'shared='+share.id)}`;
    trackEvent('share_click',{surface:'draft_run_result'});
    const result=await shareDraftRunCard(run,url);
    const status=document.querySelector('#run-share-status');
    if(result.failed) {status.textContent='Copy this link: ';const a=document.createElement('a');a.href=url;a.textContent=url;status.append(a);}
    else if(!result.cancelled) {status.textContent=result.method==='copy_fallback'?'Result and run link copied.':'';trackEvent(run.day?'daily_result_shared':'shared_run_shared',{mode:'draft_run',method:result.method});}
  } catch(e) {document.querySelector('#run-share-status').textContent=e.message;}
  finally {button.disabled=false;}
}
async function showBoard(period='daily') {
  app().innerHTML='<section class="message-card"><h1>Loading the board…</h1></section>';
  const [data,access]=await Promise.all([
    api(`/v1/leaderboard?period=${encodeURIComponent(period)}&environment=${environment}`,undefined,false),
    loadDailyStatus().catch(()=>null),
  ]);
  document.body.classList.remove('is-game');
  const claimed=Boolean(access?.player?.claimed),capabilities=access?.capabilities||[];
  const customPractice=claimed&&capabilities.includes('custom_corpus');
  const cubePractice=claimed&&capabilities.includes('unlimited_cube_practice');
  const practiceAction=environment==='latest'
    ? (customPractice?'<a class="button secondary" href="?game=draft-run&custom=1">Choose sets for practice</a>':'<a class="button secondary" href="?game=draft-run">Practice a Draft Run</a>')
    : cube()
      ? (cubePractice?`<a class="button secondary" href="${gameUrl()}">Practice a Powered Cube Run</a>`:'<a class="button secondary" href="?game=draft-run">Practice a Draft Run</a>')
      : `<a class="button secondary" href="${gameUrl()}">Practice a Draft Run</a>`;
  app().innerHTML=`<section class="run-board"><p class="eyebrow">Leaderboards</p><h1>${environment==='latest'?'Latest Set':cube()?'Cube':'Draft Run'}</h1><nav class="run-board-games" aria-label="Leaderboard game"><a class="${environment==='mixed'?'active':''}" href="${boardUrl('mixed',period)}">Draft Run</a><a class="${cube()?'active':''}" href="${boardUrl('powered-cube',period)}">Cube</a><a class="${environment==='latest'?'active':''}" href="${boardUrl('latest',period)}">Latest Set</a></nav><nav class="run-board-periods" aria-label="Leaderboard period">${[['daily','Today'],['week','This week'],['month','This month'],['all','All time']].map(([id,name])=>`<a class="${period===id?'active':''}" href="${gameUrl('board='+id)}">${name}</a>`).join('')}</nav><p>${period==='daily'?'First attempts on today’s shared starting packs.':'Average of first-attempt Daily scores, with days played shown alongside.'}</p>${data.rows.length?`<ol>${data.rows.map(r=>`<li><b>${r.rank}</b>${r.profile_key?`<a href="?profile=${esc(r.profile_key)}">${esc(r.display_name)}</a>`:`<span>${esc(r.display_name)}</span>`}<small>${r.days} ${r.days===1?'day':'days'}</small><strong>${r.score}</strong></li>`).join('')}</ol>`:`<p class="run-empty">A fresh board. Finish today’s ${title()} to set the score to beat.</p>`}<div class="run-board-actions"><a class="button primary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a>${practiceAction}</div></section>`;
  trackEvent('leaderboard_view',{mode:'draft_run',set_id:environment,period});
}
async function launch(options={}) {
  app().innerHTML='<section class="message-card"><h1>Finding your packs…</h1></section>';
  const entrySource=!options.id&&options.daily===true&&window.PACK1_ENTRY_SOURCE==='result_share'?'result_share':null;
  run=options.id?await api(`/v1/runs/${options.id}`):await api('/v1/runs',{daily:options.daily===true,challenge:options.challenge,environment,setIds:options.setIds,...(entrySource?{source:entrySource}:{})});
  if(entrySource)delete window.PACK1_ENTRY_SOURCE;
  environment=run.environment||environment;
  const url=new URL(location.href);if(environment!=='mixed')url.searchParams.set('set',environment);else url.searchParams.delete('set');url.searchParams.delete('challenge');url.searchParams.delete('shared');url.searchParams.delete('custom');url.searchParams.set('run',run.id);history.replaceState({},'',url);
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
  if(error.capability||error.status===401){
    const premium=['custom_corpus','unlimited_cube_practice'].includes(error.capability);
    const signedIn=hasAccountSession();
    app().innerHTML=`<section class="message-card"><h1>${premium?'Elite practice':signedIn?'Practice access':'Keep drafting with a free account'}</h1><p>${esc(error.message)}</p>${premium?'<p>Elite membership includes custom sets and unlimited Cube practice.</p>':''}<div class="button-row">${premium?'<button class="button primary" id="practice-membership">'+(signedIn?'Become Elite on Patreon':'Sign in to become Elite')+'</button>':''}${!premium&&!signedIn?'<button class="button primary" id="practice-account">Sign in or create an account</button>':''}<a class="button secondary" href="./">Back to Dailies</a></div></section>`;
    document.querySelector('#practice-membership')?.addEventListener('click',async()=>{(await import('./growth.mjs?v=6')).beginEliteUpgrade({source:'practice_gate'});});
    document.querySelector('#practice-account')?.addEventListener('click',async()=>{(await import('./growth.mjs?v=6')).renderAccount();});return;
  }
  console.warn('Draft Run page failed to load',error?.message);
  const retry=`<button class="button primary" type="button" data-run-retry="1">Try again</button>`;
  const secondary=isBoard
    ? `<a class="button secondary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a>`
    : `<a class="button secondary" href="${gameUrl()}">Start a fresh run</a>`;
  app().innerHTML=`<section class="message-card"><h1>${isBoard?'Couldn’t load the leaderboard.':'Couldn’t start that run.'}</h1><p>${esc(failureMessage(error))}</p><div class="button-row">${retry}${secondary}</div><p><a class="text-button" href="./">Back home</a></p></section>`;
  app().querySelector('[data-run-retry]').onclick=()=>location.reload();
}

export async function installDraftRunPage() {
  styles();void loadSetNames().then(()=>{if(run&&app().querySelector('.draft-run-page'))render();});document.querySelector('#brand-home').onclick=()=>location.href='./';
  document.querySelector('#daily-nav').onclick=()=>location.href=gameUrl('daily=1');
  document.querySelector('#leaderboard-nav').onclick=()=>location.href=gameUrl('board=daily');
  const params=new URLSearchParams(location.search);
  try {
    if(params.has('board')) {await showBoard(params.get('board'));return;}
    if(params.has('custom')&&!params.has('run')){await customPractice();return;}
    if((params.has('shared')||params.has('challenge'))&&!params.has('run')) {
      const info=await api('/v1/shared-runs/'+encodeURIComponent(params.get('shared')||params.get('challenge')),undefined,false);
      environment=info.environment||'mixed';
      app().innerHTML=`<section class="run-invite"><p class="eyebrow">A friend’s ${title()}</p><h1>Play this run and compare.</h1><p>${esc(info.name)} sent you ${draftRunLength(info)} real decisions from trophy drafts. You’ll see the same packs and the same earlier picks.</p><button class="button primary" id="accept-run-challenge">Play this run</button><p>${cube()?'Powered Cube practice access is required.':'A free account includes regular practice.'}</p>${info.scores?.length?`<ul class="run-shared-scores">${info.scores.map(s=>`<li>${esc(s.name)} <strong>${Number(s.score)}/100</strong></li>`).join('')}</ul>`:''}<p id="run-error" role="alert"></p></section>`;
      trackEvent('challenge_open',{mode:'draft_run',kind:'stored'});
      document.querySelector('#accept-run-challenge').onclick=async()=>{try{trackEvent('challenge_start',{mode:'draft_run'});await launch({challenge:info.id});}catch(e){console.warn('Draft Run challenge failed to start',e?.message);renderLoadFailure(e,false);}};
    } else await launch({id:params.get('run'),daily:params.has('daily')});
  } catch(e) {renderLoadFailure(e,params.has('board'));}
}

async function customPractice() {
  const {sets}=await api('/v1/practice-sets');
  app().innerHTML=`<section class="practice-picker"><p class="eyebrow">Elite practice</p><h1>Choose your sets</h1><p>A fresh random run of eight decisions, balanced across your selected sets.</p><form id="practice-sets"><fieldset><legend>Choose one or more sets</legend>${sets.map((s,i)=>`<label><input type="checkbox" name="set" value="${esc(s.set_id)}" ${i===0?'checked':''}>${esc(s.set_name||s.set_id.toUpperCase())}</label>`).join('')}</fieldset><button class="button primary">Start random run</button></form><p id="run-error" role="alert"></p><a href="./">Back to Dailies</a></section>`;
  document.querySelector('#practice-sets').onsubmit=async event=>{event.preventDefault();const setIds=new FormData(event.currentTarget).getAll('set');if(!setIds.length){document.querySelector('#run-error').textContent='Choose at least one set.';return;}try{environment='mixed';await launch({setIds});}catch(e){renderLoadFailure(e,false);}};
}
