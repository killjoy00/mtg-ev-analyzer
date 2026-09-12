import { loadMyProfile } from './growth-api.mjs';
import { renderAccount } from './growth.mjs';
import { trackEvent } from './retention-events.mjs';

export function nextMilestones(profile,limit=3) {
  return (profile?.achievements||[]).filter(a=>!a.unlocked&&a.target>1&&a.current>0)
    .sort((a,b)=>b.current/b.target-a.current/a.target||a.target-b.target).slice(0,limit);
}
export function claimReason(profile) {
  const s=profile?.summary||{};
  if(profile?.player?.claimed)return null;
  if(s.current_streak>=2)return `Keep your ${s.current_streak}-day Daily streak across devices.`;
  if(s.games>=3)return `Save your ${s.games} games and your player record across devices.`;
  if(s.best_score>=85)return `Keep that ${s.best_score}-point personal best.`;
  return null;
}
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const seen=new Set();let latest=null;
async function enhance(detail={}) {
  const root=document.querySelector('#post-game-progress')||document.querySelector('.result-page');
  if(!root||root.dataset.progressionLoaded)return;
  root.dataset.progressionLoaded='1';
  try {
    const profile=await loadMyProfile();if(!root.isConnected)return;
    const current=(profile.achievements||[]).filter(a=>a.unlocked),previous=latest;
    latest=new Set(current.map(a=>a.id));
    const unlocked=previous?current.filter(a=>!previous.has(a.id)):[];
    for(const a of unlocked)trackEvent('achievement_view',{achievement:a.id,source:'result'});
    const next=nextMilestones(profile,1)[0],reason=claimReason(profile);
    if(!next&&!reason&&!unlocked.length)return;
    const box=root.id==='post-game-progress'?root:document.createElement('aside');box.className='post-game-progress';
    if(root.id==='post-game-progress') {
      if(!next&&!unlocked.length)return;
      box.innerHTML=`<p class="post-game-progress-label">Achievements</p>${unlocked.length?`<p><strong>${esc(unlocked[0].label)}</strong> unlocked.</p>`:''}${next?`<p><strong>Up next: ${esc(next.label)}</strong><br><span>${esc(next.progress_text)} · ${esc(next.description)}</span></p>`:''}`;
      return;
    }
    box.innerHTML=`${unlocked.length?`<p><strong>${esc(unlocked[0].label)}</strong> unlocked.</p>`:''}${next?`<p><strong>Up next: ${esc(next.label)}</strong><br><span>${esc(next.progress_text)} · ${esc(next.description)}</span></p>`:''}<div><button class="text-button" data-open-career>View your career</button>${reason?'<button class="text-button" data-claim-progress>Save my progress</button>':''}</div>${reason?`<small>${esc(reason)}</small>`:''}`;
    if(box!==root)root.append(box);
    box.querySelector('[data-open-career]').onclick=()=>document.querySelector('#account-nav')?.click();
    box.querySelector('[data-claim-progress]')?.addEventListener('click',()=>{trackEvent('account_claim_prompt_clicked',{source:'result'});void renderAccount();});
    if(reason)trackEvent('account_claim_prompt_viewed',{source:'result'});
  } catch { /* Progression never blocks the game or its result. */ }
}
export function installProgression() {
  void loadMyProfile().then(p=>{latest=new Set((p.achievements||[]).filter(a=>a.unlocked).map(a=>a.id));}).catch(()=>{});
  document.addEventListener('pack1:result-completed',e=>{if(seen.has(e.detail.id))return;seen.add(e.detail.id);trackEvent('result_viewed',e.detail);});
  document.addEventListener('pack1:result-visible',e=>void enhance(e.detail));
}
