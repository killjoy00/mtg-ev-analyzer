import { getAuthSession, linkAccount, loadRemoteStats, saveGameResult, sendEvents, signInAccount, signOutAccount, signUpAccount } from './growth-api.mjs';
import { onAppRender } from './render-lifecycle.mjs';
import { trackEvent } from './retention-events.mjs';

const HISTORY_KEY = 'pack1-game-history-v2';
const RESULT_SEEN = new WeakSet();
let currentAccount = null;
let challengeStartTracked = false;

function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
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
  box.innerHTML=`<span>Friend challenge</span><strong>${esc(by||'Your friend')} scored ${target}</strong><em>Same exact pack. Beat the score.</em>`;
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
  if(share){share.classList.remove('primary','challenge-primary');share.classList.add('secondary');share.textContent='Challenge someone else';}
  const button=document.createElement('button'); button.type='button'; button.className='button primary challenge-return'; button.textContent='Send the result back';
  button.addEventListener('click',()=>{ if(share) share.click(); else navigator.share?.({title:'Pack One',url:location.href}); event('challenge_reshare'); });
  actions.prepend(button);
}
function localSummary(items) {
  const scores=items.map((x)=>Number(x.score)).filter(Number.isFinite);
  const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
  const wins=items.filter((x)=>x.outcome==='win').length, losses=items.filter((x)=>x.outcome==='loss').length, ties=items.filter((x)=>x.outcome==='tie').length;
  return { games:items.length, average_score:avg.toFixed(1), best_score:scores.length?Math.max(...scores):0, challenge_wins:wins, challenge_losses:losses, challenge_ties:ties };
}
function group(items,key) {
  const map=new Map(); for(const item of items){const k=item[key]||'unknown'; const arr=map.get(k)||[];arr.push(item);map.set(k,arr);} return [...map].map(([name,rows])=>({name,...localSummary(rows)}));
}
function statsRows(rows,labelKey='name') { return rows.map((row)=>`<tr><th>${esc(String(row[labelKey]||'').toUpperCase())}</th><td>${Number(row.games||0)}</td><td>${Number(row.average_score||0).toFixed(1)}</td><td>${Number(row.best_score||0)}</td></tr>`).join(''); }
async function renderStats() {
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  const local=readHistory(); const localData={summary:localSummary(local),bySet:group(local,'setId'),byMode:group(local,'mode'),recent:[...local].reverse().slice(0,30)};
  const remote=await loadRemoteStats(); const data=remote?.summary ? remote : localData;
  const recent=remote?.recent?.length ? remote.recent.map((r)=>({playedAt:r.played_at,setId:r.set_id,mode:r.mode,score:Number(r.score),grade:r.grade,isDaily:r.is_daily,outcome:r.outcome,opponentName:r.opponent_name})) : localData.recent;
  const s=data.summary;
  app.innerHTML=`<section class="stats-page growth-page"><header><p class="eyebrow">My Stats</p><h1>Your Pack One record</h1><p>${currentAccount?.user?.email ? `Synced to ${esc(currentAccount.user.email)}.` : 'Saved on this device. Claim an account to carry it across devices.'}</p></header>
    <div class="stat-scoreboard"><div><span>Games</span><strong>${Number(s.games||0)}</strong></div><div><span>Average</span><strong>${Number(s.average_score||0).toFixed(1)}</strong></div><div><span>Best</span><strong>${Number(s.best_score||0)}</strong></div><div><span>Challenges</span><strong>${Number(s.challenge_wins||0)}–${Number(s.challenge_losses||0)}${Number(s.challenge_ties||0)?`–${Number(s.challenge_ties)}`:''}</strong></div></div>
    <section class="stats-split"><div><h2>By set</h2><table><thead><tr><th>Set</th><th>GP</th><th>Avg</th><th>Best</th></tr></thead><tbody>${statsRows(data.bySet||[],remote?'set_id':'name')}</tbody></table></div><div><h2>By mode</h2><table><thead><tr><th>Mode</th><th>GP</th><th>Avg</th><th>Best</th></tr></thead><tbody>${statsRows(data.byMode||[],remote?'mode':'name')}</tbody></table></div></section>
    <section class="recent-games"><h2>Recent games</h2>${recent.length?`<ol>${recent.map((r)=>`<li><span>${esc(String(r.setId||'').toUpperCase())} · ${r.mode==='full'?'Full Pack':'Top 3'}${r.isDaily?' · Daily':''}</span><strong>${r.score}</strong><em>${esc(r.grade||'')}${r.outcome?` · ${r.outcome}`:''}</em></li>`).join('')}</ol>`:'<p>No games recorded yet. Play one and come back.</p>'}</section>
    ${currentAccount?.user ? '' : '<button class="button primary" id="stats-claim">Save these stats across devices</button>'}</section>`;
  document.querySelector('#stats-claim')?.addEventListener('click',()=>void renderAccount());
}
function formMarkup(kind) {
  return `<form class="account-form" id="account-${kind}"><label>Email<input required type="email" name="email" autocomplete="email"></label>${kind==='signup'?'<label>Display name<input required name="name" minlength="2" maxlength="24" autocomplete="nickname"></label>':''}<label>Password<input required type="password" name="password" minlength="8" maxlength="128" autocomplete="${kind==='signup'?'new-password':'current-password'}"></label><button class="button primary" type="submit">${kind==='signup'?'Create account':'Sign in'}</button><p class="form-error" aria-live="polite"></p></form>`;
}
async function claimCurrentSession() {
  const session=await getAuthSession(); if(!session?.session?.token || !session?.user) return null;
  const linked=await linkAccount(session.session.token); currentAccount=session; return linked;
}
export async function renderAccount() {
  document.body.classList.remove('is-game');
  const app=document.querySelector('#app'); if(!app) return;
  currentAccount=await getAuthSession();
  if(currentAccount?.session?.token && currentAccount?.user) {
    await linkAccount(currentAccount.session.token).catch(()=>null);
    app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account access</p><h1>Your record is saved.</h1><p>Signed in as <strong>${esc(currentAccount.user.email)}</strong>. Your Pack One identity follows you across devices.</p></header><div class="account-actions"><button class="button primary" id="account-career">Back to my career</button><button class="button secondary" id="account-signout">Sign out</button></div><p class="account-note">Playing never requires an account. Signing out returns this browser to guest-first play.</p></section>`;
    document.querySelector('#account-career')?.addEventListener('click',()=>document.querySelector('#account-nav')?.click());
    document.querySelector('#account-signout')?.addEventListener('click',async()=>{await signOutAccount();currentAccount=null;event('auth_sign_out');void renderAccount();});
    return;
  }
  app.innerHTML=`<section class="account-page growth-page"><header><p class="eyebrow">Account access</p><h1>Save your progress.</h1><p>Keep your games, streaks, achievements, and career across devices. Playing is always free, with or without an account.</p></header><div class="account-columns"><div><h2>Create account</h2>${formMarkup('signup')}</div><div><h2>Sign in</h2>${formMarkup('signin')}</div></div><div class="account-actions"><button class="button secondary" id="account-career">Back to my career</button><button class="text-button" id="account-home">Keep playing as guest</button></div></section>`;
  document.querySelector('#account-career')?.addEventListener('click',()=>document.querySelector('#account-nav')?.click());
  document.querySelector('#account-home')?.addEventListener('click',()=>document.querySelector('#brand-home')?.click());
  document.querySelector('#account-signup')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,err=f.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(f));await signUpAccount(data);await claimCurrentSession();event('auth_sign_up');await renderAccount();}catch(x){err.textContent=x.message;}});
  document.querySelector('#account-signin')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,err=f.querySelector('.form-error');err.textContent='';try{const data=Object.fromEntries(new FormData(f));await signInAccount(data);await claimCurrentSession();event('auth_sign_in');await renderAccount();}catch(x){err.textContent=x.message;}});
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
function shareCompletedAnalytics(eventObject) {
  const detail=eventObject.detail||{};
  event('share_completed',{ method:String(detail.method||'unknown').slice(0,40), context:String(detail.context||'unknown').slice(0,40), challenge:Boolean(detail.challenge) });
}
function enhance() { challengeBanner(); resultChallengeActions(); findResults(); }

export async function installGrowthLayer() {
  currentAccount=await getAuthSession();
  if(currentAccount?.session?.token) await linkAccount(currentAccount.session.token).catch(()=>null);
  event('page_view',{ account:Boolean(currentAccount?.user), challenge:params().has('challenge')||params().has('vs') });
  document.addEventListener('click',clickAnalytics,true);
  document.addEventListener('pack1:share-completed',shareCompletedAnalytics);
  document.addEventListener('change',e=>{if(e.target?.id==='set-select')event('practice_set_selected',{set:e.target.value});});
  onAppRender(enhance);
}
