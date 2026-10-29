import {draftRunLength} from './draft-run-format.mjs';
import { accountCsrfToken, ensurePackSession, firstPartyAuthEnabled, hasAccountSession, loadDailyStatus, storedAccountToken } from './growth-api.mjs';
import { dailyShareUrl, draftRunShareText, shareDraftRunCard, shareDate } from './share-cards.mjs?v=10';
import {openCardViewer,faceIndicatorMarkup} from './card-viewer.mjs?v=2';
import { trackEvent } from './retention-events.mjs';
import {decisionClock} from './decision-clock.mjs';
import { sortPackByRarity } from './replay-data.mjs';
import { escapeHtml as esc } from './html.mjs';
import {achievementMark} from './achievement-icons.mjs';
import { compactDraftRunFeedback, consensusFeedback, trophyDrafterDetails, trophyDrafterFacts, trophyRevealSentence } from './draft-run-feedback.mjs?v=7';
import { tcgplayerUrl } from './tcgplayer.mjs';
import {revealCardChoices,modelSupportLabel} from './draft-run-reveal.mjs?v=2';
import {openTrophyDeck} from './trophy-deck-dialog.mjs?v=3';
import { dailyResetCue, nextGameDateBoundary } from './game-date.mjs';
import {completedAllDailies,nextUnfinishedDaily} from './today-status.mjs?v=2';
import {sharedRunAppPath,sharedRunInvitationId} from './shared-run-links.mjs';
import {dismissSetRefresher,installSetGuides,setRefresherButton} from './set-guides.mjs?v=2';

const base = () => String(window.PACK1_API?.draftRunUrl||'').replace(/\/$/,'');
const webClientBuild=()=>new URL(import.meta.url).searchParams.get('v')||null;
const reportSentText='Thanks for letting us know.';
let run=null,selection=null,review=null,busy=false,dailyValidationConfirmation=null,sharedDay=null;
const reportedDecisions=new Set();
const dailyPeerCache=new Map();
const trophyDeckCache=new Map();
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
// Old month and all-time links now open the season board.
const canonicalBoardPeriod=value=>value==='month'||value==='all'?'season':value;
const boardUrl=(target,period='daily')=>`?game=draft-run${target!=='mixed'?'&set='+target:''}&board=${canonicalBoardPeriod(period)}`;
const seasonDate=value=>{const date=new Date(String(value||'')+'T12:00:00Z');return Number.isNaN(date.getTime())?String(value||''):date.toLocaleDateString(undefined,{month:'short',day:'numeric'});};
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
  installSetGuides();
  if(document.querySelector('[data-draft-run-style]')) return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./draft-run.css?v=25';link.dataset.draftRunStyle='1';document.head.appendChild(link);
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
async function publicApi(path) {
  const r=await fetch(base()+path,{method:'GET',headers:{accept:'application/json'},credentials:'omit',signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Could not reach the game. Try again.'),{status:r.status});return data;
}
// While a pick's reveal is on screen, the next pack is already known
// (run.current). Fetch its images then, so Next shows the pack immediately
// and the decision clock does not count image download time.
const prefetchedImages=new Set();
function prefetchPackImages(p) {
  for(const card of p?.candidates||[]) {
    const url=/^https:\/\//.test(card.image_url||'')?card.image_url:'';
    if(!url||prefetchedImages.has(url))continue;
    prefetchedImages.add(url);
    const img=new Image();img.decoding='async';img.src=url;
  }
}
function image(card,extra='') {
  const url=/^https:\/\//.test(card.image_url||'')?card.image_url:'';
  return url?`<img src="${esc(url)}" alt="${esc(card.name)}" decoding="async" ${extra}>`:`<span class="run-card-fallback">${esc(card.name)}</span>`;
}
// Recap rows show the card you took, plus the trophy pick when it differs.
// The names are in the row's text, so the thumbnails are hidden from screen readers.
function reviewCards(a) {
  const byId=new Map((a.puzzle?.candidates||[]).map(card=>[card.id,card]));
  const mine=byId.get(a.selectedId),trophy=a.historicalMatch?null:byId.get(a.historicalId)||null;
  const thumb=(card,kind)=>card?`<span class="${kind}">${image(card,'loading="lazy"')}</span>`:'';
  return {trophy,cards:`<span class="run-review-cards" aria-hidden="true">${thumb(mine,a.historicalMatch?'is-match':'is-mine')}${thumb(trophy,'is-trophy')}</span>`};
}
function steps() {
  return `<ol class="run-steps" aria-label="Run progress">${Array.from({length:runLength()},(_,i)=>`<li class="${run.answers[i]?'done':i===run.answers.length?'current':''}" aria-label="Round ${i+1}${run.answers[i]?`, ${run.answers[i].score} points`:''}" ${i===run.answers.length?'aria-current="step"':''}><span>${i+1}</span>${run.answers[i]?`<small>${run.answers[i].score} pts</small>`:''}</li>`).join('')}</ol>`;
}
// The strip keeps its own tinted band so earlier picks never read as part of
// the pack. --pool-count lets the cards shrink to fit one line (draft-run.css).
function pool(p) {
  const previous=p.prior_picks||[];
  const head=detail=>`<div class="run-pool-head"><h2>Earlier picks</h2>${detail}</div>`;
  if(!previous.length) return `<section class="run-pool is-empty" aria-label="Original drafter’s earlier picks">${head('<p class="run-pool-empty">No earlier picks yet.</p>')}</section>`;
  return `<section class="run-pool" aria-label="Original drafter’s earlier picks">${head(`<small>${previous.length} card${previous.length===1?'':'s'} · in pick order</small>`)}<div class="run-pool-cards" style="--pool-count:${previous.length}">${previous.map((c,i)=>`<button type="button" data-zoom-prior="${i}" aria-label="View previous pick ${i+1}: ${esc(c.name)}">${image(c)}<span>${i+1}. ${esc(c.name)} ${faceIndicatorMarkup(c)}</span></button>`).join('')}</div></section>`;
}
function revealComparison(p,answer) {
  const byId=new Map((p.candidates||[]).map(card=>[card.id,card]));
  const choices=revealCardChoices(answer);
  const creatorName=run?.comparison?.kind==='creator'?run.comparison.name:null;
  const figures=choices.map(choice=>{
    const card=byId.get(choice.id);if(!card)return '';
    const ranked=answer.ranking?.find(item=>item.id===card.id);
    const score=ranked?.score??(card.id===answer.historicalId?100:card.id===answer.selectedId?answer.score:null);
    const mine=card.id===answer.selectedId,trophy=card.id===answer.historicalId;
    const label=choice.label+(creatorName&&card.id===answer.creatorId?` · ${creatorName}’s pick`:'');
    return `<figure class="run-choice-card ${mine?'is-mine':''} ${trophy?'is-trophy':''} ${mine&&trophy?'is-match':''}" data-choice-id="${esc(card.id)}"><div class="run-choice-label">${esc(label)}</div><button type="button" class="run-choice-image" data-zoom="${esc(card.id)}" aria-label="Enlarge ${esc(card.name)}">${image(card)}</button><figcaption>${esc(card.name)}</figcaption><dl class="run-choice-stats"><div class="run-choice-points"><dt>Score</dt><dd>${score==null?'N/A':Number(score)}<small>/100</small></dd></div><div class="run-choice-support"><dt>Model support</dt><dd>${modelSupportLabel(ranked?.support,answer.consensusSupport,trophy)}</dd></div><div class="run-choice-peer" data-peer-col hidden><dt>Players’ picks</dt><dd data-peer-card="${esc(card.id)}" hidden></dd></div></dl><a class="run-card-shop" href="${esc(tcgplayerUrl(card.name))}" target="_blank" rel="sponsored noopener" data-tcgplayer-card="${esc(card.name)}" data-tcgplayer-surface="draft_run_reveal">Find on TCGplayer (affiliate link)</a></figure>`;
  }).join('');
  const creator=creatorName&&answer.creatorId&&!choices.some(c=>c.id===answer.creatorId)?byId.get(answer.creatorId):null;
  return `<div class="run-reveal-choices">${figures}</div>${creator?`<p class="run-creator-pick">${esc(creatorName)} picked <button type="button" class="text-button" data-zoom="${esc(creator.id)}">${esc(creator.name)}</button>.</p>`:''}`;
}
function revealAnalysis(p,answer) {
  return `<section class="run-analysis" aria-labelledby="run-analysis-title"><h2 id="run-analysis-title">Why this score?</h2><div class="run-analysis-body">${revealComparison(p,answer)}${consensusFeedback(answer,trophyDrafterDetails(answer))}</div></section>`;
}
function reportDecisionMarkup(answer) {
  const sent=reportedDecisions.has(answer.puzzle.puzzle_id);
  return `<div class="run-decision-report"><button type="button" class="run-report-prompt" data-report-decision aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V3m0 1c5-4 10 4 15 0v10c-5 4-10-4-15 0"/></svg><span>Does something look wrong? <u>Let us know.</u></span><span aria-hidden="true">→</span></button><span id="run-report-status" role="status">${sent?esc(reportSentText):''}</span></div>`;
}
function compactResultLabel(answer,sentence='') {
  return `${answer.score} out of 100. ${trophyRevealSentence(answer)}${sentence?` ${sentence}`:''}`;
}
async function revealDailyPeers(round,answer) {
  if(!run?.day||!Number.isInteger(round)||!answer)return;
  const id=run.id,key=`${id}:${round}`;
  const show=stats=>{
    if(!stats?.available||run?.id!==id||review!==round||
        run?.answers?.[round]?.puzzle?.puzzle_id!==answer.puzzle?.puzzle_id)return;
    const node=document.querySelector('#run-peer-stats');
    if(!node)return;
    node.textContent=`${stats.matching_pick_pct}% of players picked this · ${stats.trophy_pick_pct}% matched the trophy drafter (${stats.players} players)`;
    node.hidden=false;
    // Same threshold as the line above: the server sends per-card shares only
    // with an available summary. Cards nobody picked show 0%.
    const shares=stats.card_pick_pct;
    if(shares&&typeof shares==='object') {
      document.querySelectorAll('[data-peer-card]').forEach(cell=>{
        const pct=Number(shares[cell.dataset.peerCard]);
        cell.textContent=`${Number.isFinite(pct)?pct:0}%`;cell.hidden=false;
      });
      document.querySelectorAll('[data-peer-col]').forEach(item=>{item.hidden=false;});
    }
  };
  if(dailyPeerCache.has(key)){show(dailyPeerCache.get(key));return;}
  try {
    const result=await api(`/v1/runs/${encodeURIComponent(id)}/stats?round=${round}`);
    if(result.available)dailyPeerCache.set(key,result);
    show(result);
  } catch { /* Reveals must work even if peer statistics are unavailable. */ }
}
function cardGrid(p,answer=null) {
  const candidates=sortPackByRarity(p.candidates);
  return `<div class="run-cards">${candidates.map(c=>`<article class="run-card ${selection===c.id?'selected':''} ${answer?.historicalId===c.id?'trophy-pick':''}"><button class="run-card-select" type="button" data-pick="${esc(c.id)}" aria-label="Pick ${esc(c.name)}" aria-pressed="${selection===c.id}" ${answer?'disabled':''}>${image(c)}</button><div class="run-card-caption"><span class="run-card-name">${esc(c.name)} ${faceIndicatorMarkup(c)}</span><button class="run-zoom" type="button" data-zoom="${esc(c.id)}" aria-label="Enlarge ${esc(c.name)}"><span class="run-zoom-glyph" aria-hidden="true"></span></button></div>${answer&&(answer.historicalId===c.id||answer.selectedId===c.id)?`<span class="run-card-outcome">${answer.historicalId===c.id?'Trophy pick':'Your pick'}</span>`:''}</article>`).join('')}</div>`;
}
function rankingStateMarkup(value=run) {
  if(!value?.day)return '';
  if(value.leaderboard_eligible)return `<p class="run-ranking-state" role="status">Ranked as ${esc(value.ranked_name||'your account')}</p>`;
  if(['username_taken','username_required','name_not_allowed'].includes(value.ranking_identity?.reason)) {
    const reason=value.ranking_identity?.reason;
    const fix=reason==='name_not_allowed'
      ? 'That display name is not allowed. Choose another to join Daily leaderboards.'
      : reason==='username_taken'
        ? 'Choose a different display name. That one is already taken.'
        : 'Choose a display name to join Daily leaderboards.';
    return value.complete
      ? `<p class="run-ranking-state" role="alert"><strong>This Daily isn’t ranked yet.</strong> ${fix} You can add this score afterward.</p>`
      : `<p class="run-ranking-state" role="alert"><strong>This Daily isn’t ranked yet.</strong> ${fix} You can add the completed score afterward.</p>`;
  }
  if(hasAccountSession()) {
    return value.complete
      ? '<p class="run-ranking-state" role="status"><strong>Signed in.</strong> Add this score to today’s leaderboard when you’re ready.</p>'
      : '<p class="run-ranking-state is-quiet" role="status"><strong>Signed in.</strong> This run stays with your account.</p>';
  }
  return value.complete
    ? '<p class="run-ranking-state" role="status">Playing as guest. Sign in to add this score to the leaderboard.</p>'
    : '<p class="run-ranking-state is-quiet" role="status">Playing as guest.</p>';
}
// One compact block: set and pick on the first line, mode and ranking on the
// second, round progress last. The step bar already shows the round.
function runHeading(p) {
  const mode=`${run.day?'Daily ':''}${title()} · ${run.day||'Practice'}`,short=run.day?`Daily · ${run.day}`:'Practice';
  return `<header class="run-heading"><div class="run-title"><h1>${esc(setName(p.set_id))}</h1><span class="run-pick">Pack 1 · Pick ${p.pick_number}</span></div><a class="text-button run-leave" href="./">Leave run</a><div class="run-meta"><p class="eyebrow"><span class="run-mode-full">${esc(mode)}</span><span class="run-mode-short">${esc(short)}</span></p>${rankingStateMarkup(run)}</div>${setRefresherButton(p.set_id)}${steps()}</header>`;
}
function nextNote() {
  if(run.complete)return 'Run complete';
  const left=runLength()-run.answers.length;
  return `${left} of ${runLength()} picks left`;
}
function render({land=false}={}) {
  dismissSetRefresher();
  const answer=review==null?null:run.answers[review];
  if(answer||run.complete){clock.clear();viewKey=null;}
  if(run.complete&&!answer) {renderResult();if(land)window.scrollTo({top:0,behavior:'instant'});return;}
  const p=answer?.puzzle||run.current;
  if(answer&&!run.complete)prefetchPackImages(run.current);
  const compactSentence=answer?compactDraftRunFeedback(answer):'';
  document.body.classList.add('is-game');
  app().innerHTML=`<section class="draft-run-page">${runHeading(p)}
    ${sharedDayNotice(answer)}
    ${run.comparison?run.comparison.kind==='creator'?`<aside class="run-friend"><strong>BEAT THE CREATOR</strong> · ${esc(run.comparison.name)} scored <strong>${run.comparison.score}</strong>. You’re playing the same ${runLength()} decisions.</aside>`:`<aside class="run-friend">${esc(run.comparison.name)} scored <strong>${run.comparison.score}</strong>. ${run.comparison.exact?`You’re playing the same ${runLength()} packs.`:'Packs changed. This result counts as practice.'}</aside>`:''}
    ${answer?'':pool(p)}
    ${answer?`<section class="run-feedback ${answer.historicalMatch?'is-match':'is-miss'}"><strong class="run-feedback-score">${answer.score}<small>/100</small></strong><div class="run-feedback-copy"><h2 id="run-feedback-result" tabindex="-1" aria-label="${esc(compactResultLabel(answer,compactSentence))}">${esc(trophyRevealSentence(answer))}</h2>${compactSentence?`<p>${esc(compactSentence)}</p>`:''}<div id="run-peer-stats" class="run-peer-stats" role="status" hidden></div></div></section>${revealAnalysis(p,answer)}`:
    ''}
    ${answer?`<details class="run-pack-review"><summary>Review the pack</summary>${pool(p)}${cardGrid(p,answer)}</details>`:`<div class="run-pack-head"><h2>Choose one</h2><p>${p.candidates.length} cards in this pack</p></div>${cardGrid(p)}`}
    ${answer?`${reportDecisionMarkup(answer)}<div class="run-next-dock"><span class="run-next-note">${nextNote()}</span><button class="button primary" id="run-next">${run.complete?'See result':'Next pick'}</button></div>`:''}
    ${answer?'':`<div class="run-lock${run.day||run.comparison?.exact?' is-awaiting':''}"><div class="run-lock-choice"><span id="run-selection-label">Choose a card</span><button class="button primary" id="run-lock" disabled>Lock pick</button></div>${run.day||run.comparison?.exact?'':`<div class="run-tools"><div>${cube()||run.custom_set_ids?.length?'':`<button class="button secondary" data-reroll="set" ${!run.rerolls.set||run.set_reroll_allowed===false?'disabled':''}>Reroll set · ${run.rerolls.set}</button>`}<button class="button secondary" data-reroll="pack" ${!run.rerolls.pack?'disabled':''}>Reroll pack · ${run.rerolls.pack}</button></div></div>`}</div>`}
    <p class="run-error" id="run-error" role="alert"></p></section>`;
  bind(p,answer);
  placeRun(land);
  if(answer) {document.querySelector('#run-feedback-result')?.focus({preventScroll:true});void revealDailyPeers(review,answer);}
  else recordView();
}
// Every view after the first opens at the run header, with the site menu just
// above it. Wider screens then size the pack so all of it fits above the lock
// bar when it can, never below a readable card width.
const PACK_MAX_CARD=200,LOCK_RESERVE=72;
function runTop() {
  const page=app().querySelector('.draft-run-page');
  return page?Math.max(0,Math.round(page.getBoundingClientRect().top+scrollY-8)):0;
}
function fitPack(top) {
  const page=app().querySelector('.draft-run-page'),grid=page?.querySelector(':scope>.run-cards');
  if(!grid)return;
  page.style.removeProperty('--pack-columns');
  if(innerWidth<=600)return;
  const width=grid.clientWidth,gap=Number.parseFloat(getComputedStyle(grid).columnGap)||12,floor=innerWidth>1100?150:120;
  const limit=innerHeight+top-LOCK_RESERVE;
  for(let cols=Math.max(3,Math.ceil((width+gap)/(PACK_MAX_CARD+gap)));cols<=10;cols++) {
    if((width-(cols-1)*gap)/cols<floor)break;
    page.style.setProperty('--pack-columns',cols);
    if(grid.getBoundingClientRect().bottom+scrollY<=limit)return;
  }
}
function placeRun(land) {
  const top=land?runTop():0;
  fitPack(top);
  if(land)window.scrollTo({top,behavior:'instant'});
}
let fitFrame=0;
window.addEventListener('resize',()=>{
  cancelAnimationFrame(fitFrame);
  fitFrame=requestAnimationFrame(()=>{if(run&&review==null&&!run.complete)fitPack(Math.min(scrollY,runTop()));});
});
// A result-share link always opens the recipient's current Daily. When the
// friend's score came from an earlier Daily, say so before the first pick.
function sharedDayNotice(answer) {
  if(answer||!run.day||!sharedDay||sharedDay>=run.day||run.answers.length)return '';
  return `<aside class="run-friend" data-shared-day-notice>Your friend’s score was from the ${esc(shareDate(sharedDay))} Daily. Today’s picks are different, so your scores won’t be directly comparable.</aside>`;
}
function openDecisionReport(answer) {
  const round=review;
  if(!Number.isInteger(round)||!run?.answers?.[round])return;
  const dialog=document.createElement('dialog');
  dialog.className='run-report-dialog';
  dialog.innerHTML=`<form method="dialog" class="run-report-form"><h2>Does something look wrong?</h2><p>Tell us what you noticed.</p><fieldset>
    <label><input type="radio" name="reason" value="draft_context" required> The draft context looks wrong</label>
    <label><input type="radio" name="reason" value="card_or_image"> The card or image looks wrong</label>
    <label><input type="radio" name="reason" value="score_recommendation"> The pick or score looks wrong</label>
    <label><input type="radio" name="reason" value="uninteresting"> This isn’t an interesting decision</label>
    <label><input type="radio" name="reason" value="broken"> Something isn’t working</label>
    <label><input type="radio" name="reason" value="other"> Other</label>
  </fieldset><label class="run-report-comment">Anything else?<textarea name="comment" maxlength="500" rows="3"></textarea></label>
  <p class="run-report-error" role="alert"></p><div class="run-report-actions"><button type="submit" class="button primary">Send report</button><button type="button" class="button secondary" data-report-cancel>Cancel</button></div></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),submit=form.querySelector('[type="submit"]'),error=form.querySelector('.run-report-error');
  dialog.querySelector('[data-report-cancel]').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove());
  form.onsubmit=async event=>{
    event.preventDefault();
    if(submit.disabled)return;
    const data=new FormData(form),reason=String(data.get('reason')||''),comment=String(data.get('comment')||'').trim();
    if(!reason){error.textContent='Choose what seems wrong.';return;}
    submit.disabled=true;error.textContent='';
    try {
      await api(`/v1/runs/${run.id}/report`,{
        round,puzzleId:answer.puzzle.puzzle_id,reason,comment:comment||null,
        client:{platform:'web',version:null,build:webClientBuild()},
      });
      reportedDecisions.add(answer.puzzle.puzzle_id);
      dialog.close();
      const status=document.querySelector('#run-report-status');
      if(status)status.textContent=reportSentText;
    } catch(e) {
      error.textContent=e.message||'Could not send the report. Try again.';
      submit.disabled=false;
    }
  };
  dialog.showModal();
}
function zoom(card) { return openCardViewer(card); }
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
  if(answer) {
    // Next pick sits where Lock pick was. A brief hold stops the second click
    // of a double-click on Lock from skipping straight past the reveal.
    const next=document.querySelector('#run-next');
    next.disabled=true;setTimeout(()=>{next.disabled=false;},350);
    next.onclick=()=>{review=null;selection=null;render({land:true});};
    const report=app().querySelector('[data-report-decision]');if(report)report.onclick=()=>openDecisionReport(answer);
    const deck=app().querySelector('[data-trophy-deck]');
    if(deck)deck.onclick=()=>{
      const id=run.id,round=review,key=`${id}:${round}`;
      openTrophyDeck(async()=>{
        if(!trophyDeckCache.has(key))trophyDeckCache.set(key,await api(`/v1/runs/${id}/deck?round=${round}`));
        return trophyDeckCache.get(key);
      },{record:trophyDrafterFacts(answer)?.record,trophyName:answer.historicalName,priorNames:(answer.puzzle.prior_picks||[]).map(card=>card.name)});
    };
    return;
  }
  app().querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    if(busy)return;selection=b.dataset.pick;
    app().querySelectorAll('[data-pick]').forEach(c=>{c.setAttribute('aria-pressed',String(c.dataset.pick===selection));c.closest('.run-card').classList.toggle('selected',c.dataset.pick===selection);});
    document.querySelector('#run-selection-label').textContent=p.candidates.find(c=>c.id===selection).name;document.querySelector('#run-lock').disabled=false;
    // Without rerolls the lock bar appears only once there is a choice. Keep
    // the chosen card clear of it.
    const lock=document.querySelector('.run-lock');
    if(lock?.classList.contains('is-awaiting')) {
      lock.classList.remove('is-awaiting');
      const bar=lock.getBoundingClientRect(),card=b.getBoundingClientRect();
      if(card.bottom>bar.top&&card.top<bar.top)window.scrollBy({top:card.bottom-bar.top+8,behavior:'smooth'});
    }
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
    review=action==='pick'?round:null;selection=null;render({land:true});
    if(action==='reroll') trackEvent('draft_run_rerolled',{type:body.type,round:round+1,daily:Boolean(run.day)});
    if(run.complete) document.dispatchEvent(new CustomEvent('pack1:result-completed',{detail:{id:`draft-run:${run.id}`,score:run.score,mode:'draft_run',set_id:run.environment,daily:Boolean(run.day)}}));
  } catch(e) {
    // Recover authoritative state after a lost response or a second-tab write.
    const message=e.message;
    try {run=await api(`/v1/runs/${run.id}`);review=run.answers.length>round?round:null;selection=null;render();} catch {render();}
    document.querySelector('#run-error').textContent=message;
  } finally {busy=false;}
}
// Hidden until renderDailyResultCue confirms today's three Dailies are done.
function dailySetCompleteMarkup() {
  if(!run.day||!run.complete||run.leaderboard_eligible||hasAccountSession())return '';
  return `<aside class="run-daily-set-complete" data-daily-set-complete aria-labelledby="run-daily-set-complete-title" hidden>
    <span class="run-daily-set-complete-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8"/><path d="m6.5 10.2 2.3 2.3 4.7-4.9"/></svg></span>
    <div><p class="eyebrow">Finished all 3 free dailies</p><h2 id="run-daily-set-complete-title">Finished today's Dailies? Keep drafting.</h2><p>Sign in or create a free account to play unlimited regular Draft Runs, save your scores, and join the leaderboard.</p></div>
    <button class="button primary" type="button">Sign in for unlimited runs</button>
  </aside>`;
}
// Sharing sits right under the score, compact enough on a phone that the
// next-Daily button stays on screen. No card names, so nothing is spoiled.
function dailySharePanelMarkup() {
  return `<section class="run-share-panel" aria-labelledby="run-share-title"><div class="run-share-copy"><h2 id="run-share-title">Share your result</h2><p>Share your score and colored squares, not the cards. Friends can play the same Daily for free without signing up.</p></div>
    <div class="run-share-actions"><button class="button primary" id="run-share" type="button">Share result</button><button class="button secondary" id="run-copy-result" type="button">Copy result</button></div>
    <div id="run-share-status" role="status"></div></section>`;
}
function resultRepeatAction() {
  if(run.day||run.comparison?.kind==='creator')return {href:'./',label:'Back to Dailies'};
  if(run.custom_set_ids?.length)return {href:'?game=draft-run&custom=1',label:'Choose Sets for Another Run'};
  return {href:gameUrl(),label:`Start Another ${title()}`};
}
async function renderDailyResultCue(resultId) {
  if(!run?.day)return;
  const root=document.querySelector('#post-game-progress');
  if(!root)return;
  const status=await loadDailyStatus().catch(()=>null);
  if(!root.isConnected||run?.id!==resultId||!run.day)return;
  const streak=Number(status?.daily_streak||0);
  const cue=document.createElement('p');
  cue.className='post-game-daily-cue';
  cue.textContent=`${dailyResetCue()}${streak>=2?` · ${streak}-day streak`:''}`;
  root.append(cue);
  // Only an authoritative, current-day history can turn the fallback home link
  // into a direct next Daily. Failed or delayed status leaves navigation safe.
  const next=nextUnfinishedDaily(status,{completedDay:run.day,completedEnvironment:run.environment});
  if(next) {
    const page=root.closest('.run-result-page');
    const primary=page?.querySelector('[data-next-daily-action]');
    if(primary) {
      primary.href=next.href;
      primary.textContent=next.label;
      page.querySelector('[data-all-dailies]')?.removeAttribute('hidden');
    }
  }
  // A guest sees the sign-in handoff only once today's authoritative history
  // shows all three Dailies, and never after the Pacific reset.
  const setComplete=root.closest('.run-result-page')?.querySelector('[data-daily-set-complete]');
  if(setComplete&&!hasAccountSession()&&completedAllDailies(status,{completedDay:run.day,completedEnvironment:run.environment})) {
    setComplete.hidden=false;
    setTimeout(()=>{setComplete.hidden=true;},Math.max(0,nextGameDateBoundary()-Date.now()));
  }
}
function renderResult() {
  document.body.classList.remove('is-game');
  poolObserver?.disconnect();poolObserver=null;
  const matches=run.answers.filter(a=>a.historicalMatch).length;
  const repeat=resultRepeatAction();
  const creator=run.comparison?.kind==='creator'?run.comparison:null;
  const creatorOutcome=creator?.outcome;
  const creatorHeadline=creatorOutcome==='win'?`You beat ${creator.name}`:creatorOutcome==='tie'?`You tied ${creator.name}`:creatorOutcome==='loss'?`${creator.name} got you this time`:null;
  app().innerHTML=`<section class="run-result-page"><p class="eyebrow">${creator?'BEAT THE CREATOR · ':run.day?'Daily ':''}${title()} complete</p><h1>${creatorHeadline?esc(creatorHeadline):`Your ${cube()?'Cube Run':'Draft Run'}.`}</h1><div class="run-final-score"><strong>${run.score}</strong><span>/100<br>${creator?`${Number(creator.creator_matches||0)}/${runLength()} creator picks matched · ${Number(creator.trophy_matches||matches)}/${runLength()} trophy picks matched`:`${matches} trophy picks matched`}</span></div>
    ${creator?`<p class="run-friend">You: <strong>${run.score}</strong> · ${esc(creator.name)}: <strong>${creator.score}</strong></p>`:''}
    <aside id="post-game-progress" class="post-game-progress" data-result-id="draft-run:${run.id}"></aside>
    ${run.standing?`<p class="run-standing">#${run.standing.rank} of ${run.standing.total} today${run.standing.percentile?` · Top ${run.standing.percentile}%`:''}. ${run.standing.final?'Final result.':'The board closes at midnight Pacific.'}</p>`:''}
    ${dailyValidationConfirmation?`<div class="run-validation-success" role="status" data-daily-validation-confirmation><strong>Score added to today's leaderboard</strong>${dailyValidationConfirmation.standing?`<span>#${dailyValidationConfirmation.standing.rank} of ${dailyValidationConfirmation.standing.total}${dailyValidationConfirmation.standing.percentile?` · Top ${dailyValidationConfirmation.standing.percentile}%`:''}</span>`:''}<a class="text-button" href="${gameUrl('board=daily')}">View leaderboard</a></div>`:''}
    ${run.day?dailySharePanelMarkup():''}
    ${rankingStateMarkup(run)}
    ${dailySetCompleteMarkup()}
    ${run.comparison&&run.comparison.kind!=='creator'?`<p class="run-friend">${run.comparison.exact?`You: ${run.score} · ${esc(run.comparison.name)}: ${run.comparison.score}`:'You and your friend played different packs, so the scores aren’t directly comparable.'}</p>`:''}
    ${creator?.creator_post_run_note?`<blockquote class="run-friend"><strong>${esc(creator.name)} after the run:</strong> “${esc(creator.creator_post_run_note)}”</blockquote>`:''}
    <div class="run-result-actions"><a class="button primary" data-next-daily-action href="${repeat.href}">${repeat.label}</a>${run.day?'':'<button class="button secondary" id="run-share">Share this run and compare</button><button class="button secondary" id="run-copy-result" type="button">Copy result</button>'}<a class="button secondary" href="${gameUrl('board=daily')}">Leaderboard</a><button class="button secondary" id="run-career">${run.day&&!run.leaderboard_eligible?(['username_taken','username_required','name_not_allowed'].includes(run.ranking_identity?.reason)?'Choose display name to add score':hasAccountSession()?'Add score to leaderboard':'Sign in to add score'):'View your career'}</button></div>
    ${run.day?'<p data-all-dailies hidden><a class="text-button" href="./">All Dailies</a></p>':''}
    <h2>Your ${runLength()} picks</h2><ol class="run-review-list">${run.answers.map((a,i)=>{const {cards,trophy}=reviewCards(a);return `<li><button data-review="${i}"><span>${i+1}</span>${cards}<div><strong>${esc(setName(a.puzzle.set_id))} · Pick ${a.pickNumber}</strong><small>${esc(a.selectedName)}${a.historicalMatch?' · Trophy match':trophy?` · Trophy pick: ${esc(trophy.name)}`:''}</small></div><b>${a.score}</b></button></li>`;}).join('')}</ol>
    <p class="run-note">Your final score is the average of your ${runLength()} picks. Matching the trophy drafter earns 100; other picks can score up to 95 based on the model.</p>${run.day?'':'<div id="run-share-status" role="status"></div>'}<p id="run-error" role="alert"></p></section>`;
  app().querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{review=Number(b.dataset.review);render({land:true});});
  document.querySelector('#run-share').onclick=()=>shareResult();
  document.querySelector('#run-copy-result').onclick=()=>shareResult({copy:true});
  document.querySelector('#run-career').onclick=async()=>{if(run.day&&!run.leaderboard_eligible){(await import('./growth.mjs?v=32')).renderAccount({validateDailyRunId:run.id,source:'daily_result'});return;}document.querySelector('#account-nav')?.click();};
  const setCompleteSignIn=document.querySelector('[data-daily-set-complete] button');
  if(setCompleteSignIn)setCompleteSignIn.onclick=async()=>(await import('./growth.mjs?v=32')).renderAccount({validateDailyRunId:run.id,source:'daily_set_complete'});
  if(run.day)void renderDailyResultCue(run.id);
  document.dispatchEvent(new CustomEvent('pack1:result-visible',{detail:{id:`draft-run:${run.id}`,score:run.score,mode:'draft_run',set_id:run.environment,daily:Boolean(run.day)}}));
}
export async function returnToValidatedDaily(runId,{standing=null,confirmed=true}={}) {
  styles();
  await loadSetNames();
  if(!run||run.id!==runId||!run.complete)run=await api(`/v1/runs/${runId}`);
  if(!run?.day||!run?.complete)throw new Error('Completed Daily result is unavailable.');
  environment=run.environment||environment;
  selection=null;review=null;
  if(confirmed)run.leaderboard_eligible=true;
  run.standing=confirmed?(standing||null):(run.standing||null);
  dailyValidationConfirmation=confirmed?{standing:standing||null}:null;
  renderResult();
  window.scrollTo({top:0,behavior:'instant'});
}

async function shareResult({copy=false}={}) {
  const buttons=[...document.querySelectorAll('#run-share,#run-copy-result')];
  buttons.forEach(button=>{button.disabled=true;});
  const status=document.querySelector('#run-share-status');
  status.replaceChildren();
  try {
    const share=run.day?null:await api(`/v1/runs/${run.id}/share`,{});
    if(!run.day&&!share?.creator) {
      if(!/^[a-f0-9]{24}$/.test(String(share?.id||'')))throw new Error('Pack One could not verify this share link. Try Share again.');
      try {
        const verified=await publicApi('/v1/shared-runs/'+encodeURIComponent(share.id));
        if(verified?.id!==share.id)throw new Error('Share identity mismatch.');
      } catch {
        throw new Error('Pack One could not verify this share link. Try Share again.');
      }
    }
    const url=run.day
      ? dailyShareUrl({...run,environment:run.environment||environment},location.origin)
      : share?.creator&&share.url
        ? new URL(share.url,location.origin).toString()
        : new URL(sharedRunAppPath(share.id),location.origin).toString();
    trackEvent('share_click',{surface:'draft_run_result',method:copy?'copy_button':'native'});
    if(copy) {
      const payload=`${draftRunShareText(run)}\n${url}`;
      try {
        if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(payload);
        status.textContent='Copied your score, squares, and link. Paste it wherever you want to share.';
        document.dispatchEvent(new CustomEvent('pack1:share-completed',{detail:{method:'copy_button',context:'draft_run_result',challenge:false}}));
        trackEvent(run.day?'daily_result_shared':'shared_run_shared',{mode:'draft_run',method:'copy_button'});
      } catch {
        status.textContent='Automatic copy unavailable. Select and copy this complete result:';
        const field=document.createElement('textarea');
        field.className='run-copy-fallback';
        field.readOnly=true;
        field.rows=6;
        field.value=payload;
        field.setAttribute('aria-label','Complete result with colored squares and link');
        status.append(field);
        field.focus();
        field.select();
      }
      return;
    }
    const result=await shareDraftRunCard(run,url);
    if(result.failed) {status.textContent='Copy this link: ';const a=document.createElement('a');a.href=url;a.textContent=url;status.append(a);}
    else if(!result.cancelled) {status.textContent=result.method==='copy_fallback'?'Result and run link copied.':'';trackEvent(run.day?'daily_result_shared':'shared_run_shared',{mode:'draft_run',method:result.method});}
  } catch(e) {status.textContent=e.message;}
  finally {buttons.forEach(button=>{button.disabled=false;});}
}
async function showBoard(period='daily') {
  period=canonicalBoardPeriod(period);
  app().innerHTML='<section class="message-card"><h1>Loading the board…</h1></section>';
  const [data,access]=await Promise.all([
    api(`/v1/leaderboard?period=${encodeURIComponent(period)}&environment=${environment}`,undefined,false),
    loadDailyStatus().catch(()=>null),
  ]);
  period=canonicalBoardPeriod(data.period||period);
  document.body.classList.remove('is-game');
  const claimed=Boolean(access?.player?.claimed),capabilities=access?.capabilities||[];
  const customPractice=claimed&&capabilities.includes('custom_corpus');
  const cubePractice=claimed&&capabilities.includes('unlimited_cube_practice');
  const practiceAction=environment==='latest'
    ? (customPractice?'<a class="button secondary" href="?game=draft-run&custom=1">Choose sets for practice</a>':'<a class="button secondary" href="?game=draft-run">Practice a Draft Run</a>')
    : cube()
      ? (cubePractice?`<a class="button secondary" href="${gameUrl()}">Practice a Powered Cube Run</a>`:'<a class="button secondary" href="?game=draft-run">Practice a Draft Run</a>')
      : `<a class="button secondary" href="${gameUrl()}">Practice a Draft Run</a>`;
  const seasonContext=period==='season'&&data.season
    ? `<p class="run-board-season">${esc(data.season.name)} Season · ${esc(seasonDate(data.season.start_date))}–${data.season.end_date?esc(seasonDate(data.season.end_date)):'present'}</p>`
    : '';
  const seasonRating=period==='season'&&Boolean(data.scoring);
  const empty=period==='season'&&!data.season
    ? '<p class="run-empty">Season standings aren\'t available yet.</p>'
    : `<p class="run-empty">No scores yet. Finish today's ${title()} to get on the leaderboard.</p>`;
  app().innerHTML=`<section class="run-board"><p class="eyebrow">Leaderboards</p><h1>${environment==='latest'?'Latest Set':cube()?'Cube':'Draft Run'}</h1><nav class="run-board-games" aria-label="Leaderboard game"><a class="${environment==='mixed'?'active':''}" href="${boardUrl('mixed',period)}">Draft Run</a><a class="${cube()?'active':''}" href="${boardUrl('powered-cube',period)}">Cube</a><a class="${environment==='latest'?'active':''}" href="${boardUrl('latest',period)}">Latest Set</a></nav><nav class="run-board-periods" aria-label="Leaderboard period">${[['daily','Today'],['week','This week'],['season','This season']].map(([id,name])=>`<a class="${period===id?'active':''}" href="${gameUrl('board='+id)}">${name}</a>`).join('')}</nav>${seasonContext}<p>${seasonRating?'Season rating uses every first-attempt Daily score, with a larger deduction when you have played fewer days. You rank after your first Daily; missed days do not count as zero.':period==='daily'?'First attempts on today’s shared starting packs.':`Average of your best ${data.best_of||(period==='week'?3:10)} first-attempt Daily scores ${period==='week'?'this week':'this season'}; days not played count as 0. Days played are shown alongside.`}</p>${data.rows.length?`<ol>${data.rows.map(r=>`<li><b>${r.rank}</b><span><span class="run-board-player">${r.profile_key?`<a href="?profile=${esc(r.profile_key)}">${esc(r.display_name)}</a>`:`<span>${esc(r.display_name)}</span>`}${achievementMark(r.showcase_achievement,{compact:true})}</span>${seasonRating?`<small class="run-board-average">Avg ${Number(r.average_score).toFixed(1)}</small>`:''}</span><small>${r.days} ${r.days===1?'day':'days'}</small><strong>${seasonRating?`<small>Rating</small>${Number(r.rating).toFixed(1)}`:r.score}</strong></li>`).join('')}</ol>`:empty}<div class="run-board-actions"><a class="button primary" href="${gameUrl('daily=1')}">Play today’s ${title()}</a>${practiceAction}</div></section>`;
  trackEvent('leaderboard_view',{mode:'draft_run',set_id:environment,period,season_id:data.season?.id,season_set_id:data.season?.set_id});
}
async function launch(options={}) {
  app().innerHTML='<section class="message-card"><h1>Finding your packs…</h1></section>';
  const entrySource=!options.id&&options.daily===true&&window.PACK1_ENTRY_SOURCE==='result_share'?'result_share':null;
  run=options.id?await api(`/v1/runs/${options.id}`):await api('/v1/runs',{daily:options.daily===true,challenge:options.challenge,creatorChallenge:options.creatorChallenge,environment,setIds:options.setIds,...(entrySource?{source:entrySource}:{})});
  if(entrySource)delete window.PACK1_ENTRY_SOURCE;
  sharedDay=entrySource&&/^\d{4}-\d{2}-\d{2}$/.test(String(window.PACK1_SHARED_DAY||''))?window.PACK1_SHARED_DAY:null;
  delete window.PACK1_SHARED_DAY;
  if(sharedDay&&run.day&&sharedDay<run.day)trackEvent('daily_share_notice',{kind:'earlier_day',set:run.environment});
  environment=run.environment||environment;
  const url=new URL(location.href);if(environment!=='mixed')url.searchParams.set('set',environment);else url.searchParams.delete('set');url.searchParams.delete('challenge');url.searchParams.delete('shared');url.searchParams.delete('creator');url.searchParams.delete('custom');url.searchParams.set('run',run.id);history.replaceState({},'',url);
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
    const friendSignIn=!signedIn&&sharedRunInvitationId(location.href);
    app().innerHTML=`<section class="message-card"><h1>${premium?'Elite practice':signedIn?'Practice access':'Keep drafting with a free account'}</h1><p>${esc(error.message)}</p>${premium?'<p>Elite membership includes custom sets and unlimited Cube practice.</p>':''}<div class="button-row">${premium&&!friendSignIn?'<button class="button primary" id="practice-membership">'+(signedIn?'Become Elite':'Sign in to become Elite')+'</button>':''}${friendSignIn||!premium&&!signedIn?'<button class="button primary" id="practice-account">'+(friendSignIn?'Sign in to play this run':'Sign in or create an account')+'</button>':''}<a class="button secondary" href="./">Back to Dailies</a></div></section>`;
    document.querySelector('#practice-membership')?.addEventListener('click',async()=>{(await import('./growth.mjs?v=32')).beginEliteUpgrade({source:'practice_gate'});});
    document.querySelector('#practice-account')?.addEventListener('click',async()=>{(await import('./growth.mjs?v=32')).renderAccount({sharedRunId:sharedRunInvitationId(location.href),source:'practice_gate'});});return;
  }
  const params=new URLSearchParams(location.search);
  if(!params.has('run')&&(params.has('shared')||params.has('challenge'))&&[400,404,410].includes(error.status)) {
    const invalid=error.status===400;
    app().innerHTML=`<section class="message-card"><h1>${invalid?'This challenge link is invalid.':'This challenge is no longer available.'}</h1><p>${invalid?'Check that you copied the full link, or ask your friend to send it again.':'Ask your friend for a new challenge link. You can still play today’s Daily Runs.'}</p><a class="button primary" href="./">Back to Dailies</a></section>`;
    return;
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
  const leaderboardNav=document.querySelector('#leaderboard-nav');
  if(leaderboardNav)leaderboardNav.onclick=()=>location.href=gameUrl('board=daily');
  const params=new URLSearchParams(location.search);
  try {
    if(params.has('board')) {const period=canonicalBoardPeriod(params.get('board'));if(period!==params.get('board')){const url=new URL(location.href);url.searchParams.set('board',period);history.replaceState({},'',url);}await showBoard(period);return;}
    if(params.has('custom')&&!params.has('run')){await customPractice();return;}
    if(params.has('creator')&&!params.has('run')) {
      const info=await api('/v1/creator-challenges/'+encodeURIComponent(params.get('creator')),undefined,false);
      environment=info.environment||'mixed';
      const sourceContext=info.source_type==='daily'&&info.source_day
        ? `Originally played as the ${esc(new Date(info.source_day+'T12:00:00Z').toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'}))} ${esc(title())} Daily.`
        : '';
      app().innerHTML=`<section class="run-invite"><p class="eyebrow">BEAT THE CREATOR</p><h1>${esc(info.headline||('Can you beat '+info.creator_name+'?'))}</h1><p>${esc(info.creator_name)} scored <strong>${Number(info.score)}/100</strong> on these ${Number(info.run_length)} real trophy-draft decisions.</p><p>You’ll see the same packs and prior draft context.</p>${sourceContext?`<p>${sourceContext}</p>`:''}<button class="button primary" id="accept-run-challenge">Play ${esc(info.creator_name)}’s Run</button><p>Playing this won't use up your Daily attempt or put a score on its leaderboard.</p><p id="run-error" role="alert"></p></section>`;
      trackEvent('challenge_open',{mode:'draft_run',kind:'creator',creator_challenge_id:info.id,source_type:info.source_type});
      document.querySelector('#accept-run-challenge').onclick=async()=>{try{trackEvent('challenge_start',{mode:'draft_run',kind:'creator',creator_challenge_id:info.id});await launch({creatorChallenge:info.id});}catch(e){console.warn('Creator challenge failed to start',e?.message);renderLoadFailure(e,false);}};
    } else if((params.has('shared')||params.has('challenge'))&&!params.has('run')) {
      const info=await api('/v1/shared-runs/'+encodeURIComponent(params.get('shared')||params.get('challenge')),undefined,false);
      environment=info.environment||'mixed';
      app().innerHTML=`<section class="run-invite"><p class="eyebrow">A friend’s ${title()}</p><h1>Play this run and compare.</h1><p>${esc(info.name)} sent you ${draftRunLength(info)} real decisions from trophy drafts. You’ll see the same packs and the same earlier picks.</p><button class="button primary" id="accept-run-challenge">Play this run</button><p>This shared run is free to play. No account or Elite membership required.</p>${info.scores?.length?`<ul class="run-shared-scores">${info.scores.map(s=>`<li>${esc(s.name)} <strong>${Number(s.score)}/100</strong></li>`).join('')}</ul>`:''}<p id="run-error" role="alert"></p></section>`;
      trackEvent('challenge_open',{mode:'draft_run',kind:'stored'});
      document.querySelector('#accept-run-challenge').onclick=async()=>{try{trackEvent('challenge_start',{mode:'draft_run'});await launch({challenge:info.id});}catch(e){console.warn('Draft Run challenge failed to start',e?.message);renderLoadFailure(e,false);}};
    } else await launch({id:params.get('run'),daily:params.has('daily')});
  } catch(e) {renderLoadFailure(e,params.has('board'));}
}

async function customPractice() {
  const {sets}=await api('/v1/practice-sets');
  app().innerHTML=`<section class="practice-picker"><p class="eyebrow">Elite practice</p><h1>Choose your sets</h1><p>Choose one or more sets and we'll put together eight picks from them.</p><form id="practice-sets"><fieldset><legend>Choose one or more sets</legend>${sets.map((s,i)=>`<label><input type="checkbox" name="set" value="${esc(s.set_id)}" ${i===0?'checked':''}>${esc(s.set_name||s.set_id.toUpperCase())}</label>`).join('')}</fieldset><button class="button primary">Start random run</button></form><p id="run-error" role="alert"></p><a href="./">Back to Dailies</a></section>`;
  document.querySelector('#practice-sets').onsubmit=async event=>{event.preventDefault();const setIds=new FormData(event.currentTarget).getAll('set');if(!setIds.length){document.querySelector('#run-error').textContent='Choose at least one set.';return;}try{environment='mixed';await launch({setIds});}catch(e){renderLoadFailure(e,false);}};
}
