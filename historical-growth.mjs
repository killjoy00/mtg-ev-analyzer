// Compatibility telemetry for stored historical links; never loaded by current play.
import { escapeHtml as esc } from './html.mjs';
import { saveGameResult } from './growth-api.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { trackEvent } from './retention-events.mjs';

const HISTORY_KEY = 'pack1-game-history-v2';
const RESULT_SEEN = new WeakSet();
let challengeStartTracked = false;

function params() { return new URLSearchParams(location.search); }
function event(name, props={}) { trackEvent(name, props); }
function readHistory() { try { const v=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]'); return Array.isArray(v)?v:[]; } catch { return []; } }
function writeHistory(items) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-500))); } catch {} }
function resultId() { return `r:${Date.now().toString(36)}:${crypto.randomUUID?.().slice(0,8) || Math.random().toString(36).slice(2,10)}`; }
function parseScore(root) { return Number(root.querySelector('.score-orb strong, .versus-score > div:last-child strong')?.textContent || 0); }
function parseGrade(root) { return root.querySelector('.grade-badge')?.textContent?.trim() || ''; }
function modeFromPage() { const q=params().get('mode'); if(q==='full'||q==='top3') return q; return document.querySelector('.full-result-page,.scorecard') ? 'full' : 'top3'; }
function setFromPage() {
  const q=params().get('set'); if(q) return q.toLowerCase();
  const option=document.querySelector('#set-select option:checked'); if(option) return option.value;
  const text=document.querySelector('.game-heading .eyebrow')?.textContent || '';
  return (text.split('·').pop()||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,24) || 'unknown';
}
function challengeContext(score) {
  const q=params();
  const hasSeedChallenge=q.has('vs');
  const opponentScore=hasSeedChallenge ? Number(q.get('vs')) : NaN;
  const challengeId=q.get('challenge');
  let opponentName=q.get('by')||null;
  let sourceScore=hasSeedChallenge && Number.isFinite(opponentScore)?opponentScore:null;
  const versus=document.querySelector('.versus-score');
  if(versus) {
    opponentName=versus.querySelector('div:first-child span')?.textContent?.trim()||opponentName;
    const parsed=Number(versus.querySelector('div:first-child strong')?.textContent);
    if(Number.isFinite(parsed)) sourceScore=parsed;
  }
  if(sourceScore==null) return { challengeId, opponentName:null, opponentScore:null, outcome:null };
  return { challengeId, opponentName, opponentScore:sourceScore, outcome:score>sourceScore?'win':score===sourceScore?'tie':'loss' };
}
function captureResult(root) {
  if (!root || RESULT_SEEN.has(root)) return;
  const score=parseScore(root); if(!Number.isFinite(score) || score<0 || score>100) return;
  RESULT_SEEN.add(root);
  const context=challengeContext(score);
  const item={
    clientResultId:resultId(), playedAt:new Date().toISOString(), setId:setFromPage(), mode:modeFromPage(), score,
    grade:parseGrade(root), seed:params().get('seed')||null, isDaily:params().has('daily'), ...context,
  };
  const history=readHistory(); history.push(item); writeHistory(history);
  void saveGameResult(item).then(()=>document.dispatchEvent(new CustomEvent('pack1:result-visible',{detail:{id:item.clientResultId,score:item.score,mode:item.mode,daily:item.isDaily}})));
  document.dispatchEvent(new CustomEvent('pack1:result-completed',{detail:{id:item.clientResultId,score:item.score,mode:item.mode,daily:item.isDaily}}));
  event('game_reveal',{ score:item.score, grade:item.grade, daily:item.isDaily, challenge:Boolean(item.challengeId||item.opponentScore!=null), outcome:item.outcome||undefined });
  if(item.challengeId||item.opponentScore!=null) event('challenge_complete',{ outcome:item.outcome, score:item.score, opponent_score:item.opponentScore });
  if(item.isDaily)event('daily_completed',{mode:item.mode,score:item.score});
  if(item.setId==='powered-cube')event('cube_completed',{score:item.score});
}
function findResults() {
  document.querySelectorAll('.result-page,.reveal-panel').forEach((root)=>{
    if(root.querySelector('.score-orb strong,.versus-score')) captureResult(root);
  });
}
function challengeBanner() {
  const q=params(); if(!q.has('vs')) return;
  const target=Number(q.get('vs')); const by=q.get('by');
  const heading=document.querySelector('.game-heading');
  if(!heading || !Number.isFinite(target) || heading.querySelector('.challenge-callout')) return;
  const box=document.createElement('aside'); box.className='challenge-callout';
  box.innerHTML=`<span>Shared historical run</span><strong>${esc(by||'Your friend')} scored ${target}</strong><em>Same pack. Compare your scores.</em>`;
  heading.prepend(box);
  event('challenge_open',{ target_score:target, challenger:by||'friend', kind:'seed' });
  if(!challengeStartTracked){
    challengeStartTracked=true;
    event('challenge_start',{ mode:modeFromPage(), target_score:target, challenger:by||'friend', source:'rendered_challenge' });
  }
}
function resultChallengeActions() {
  const root=document.querySelector('.result-page'); if(!root || root.dataset.growthActions==='1') return;
  root.dataset.growthActions='1';
  const q=params(); if(!q.has('vs')&&!q.has('challenge')) return;
  const actions=root.querySelector('.result-actions,.button-row'); if(!actions) return;
  const share=root.querySelector('#share-top3,#share-full');
  if(share){share.classList.remove('primary','challenge-primary');share.classList.add('secondary');share.textContent='Share this result';}
  const button=document.createElement('button'); button.type='button'; button.className='button primary challenge-return'; button.textContent='Send the result back';
  button.addEventListener('click',()=>{ if(share) share.click(); else navigator.share?.({title:'Pack One',url:location.href}); event('challenge_reshare'); });
  actions.prepend(button);
}
function clickAnalytics(eventObject) {
  const target=eventObject.target.closest?.('button,a'); if(!target) return;
  if(target.matches('[data-mode]')) {
    const challenge=params().has('challenge')||params().has('vs');
    event('game_start',{ daily:false, mode:target.dataset.mode, challenge });
    if(challenge&&!challengeStartTracked){
      challengeStartTracked=true;
      event('challenge_start',{ mode:target.dataset.mode, target_score:Number(params().get('vs'))||undefined, challenger:params().get('by')||'friend' });
    }
  }
  else if(target.matches('[data-daily-mode]')) event('game_start',{ daily:true, mode:target.dataset.dailyMode });
  else if(target.matches('[data-cube-href]')) event('cube_started',{mode:'full'});
  else if(target.matches('#reveal-top3,#reveal-challenge')) event('reveal_click');
  else if(target.matches('#share-top3,#share-full,.challenge-return,#reshare-challenge')) event('share_click',{ challenge:true, surface:target.id||'challenge_return' });
  else if(target.matches('#daily-leaders,#leaderboard-nav')) event('leaderboard_view');
}

export function installHistoricalGrowthLayer() {
  document.addEventListener('click', clickAnalytics, true);
  document.addEventListener('change', e => { if (e.target?.id === 'set-select') event('practice_set_selected', {set:e.target.value}); });
  onAppRender(() => { challengeBanner(); resultChallengeActions(); findResults(); });
}
