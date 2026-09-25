import policy from './data/selection-policy.json' with {type:'json'};
import {gameDateKey} from './game-date.mjs';

export const DRAFT_RUN_SELECTION_VERSION=policy.selection_version;
export const PREVIOUS_SELECTION_VERSION='balanced-v1';
export const TEN_PICK_SELECTION_VERSION='first-pack-v2';
export const DRAFT_RUN_LENGTH=policy.run_length;
export const isEightPickVersion=version=>['eight-pick-v3','eight-pick-v4'].includes(version);
export const runLengthForSelection=version=>isEightPickVersion(version)?DRAFT_RUN_LENGTH:10;
export const earlyRoundsForSelection=version=>isEightPickVersion(version)?5:6;
export const SELECTABLE_ONLY_SETS=new Set(policy.selectable_only_sets);
export const REGULAR_SET_ORDER=Object.freeze(policy.regular_sets_newest_first);
export const maxRunPick=environment=>policy.max_pick[environment==='powered-cube'?'powered-cube':'mixed'];
export const eligibleRunPuzzle=p=>Number(p.pack_number??1)===1 && Number(p.pick_number)<=maxRunPick(p.set_id);
export const regularRunSet=setId=>setId!=='powered-cube'&&!SELECTABLE_ONLY_SETS.has(setId);

export function releasedRunSets(day=gameDateKey()) {
  return REGULAR_SET_ORDER.filter(id=>policy.release_dates[id]&&policy.release_dates[id]<=day)
    .sort((a,b)=>policy.release_dates[b].localeCompare(policy.release_dates[a])||a.localeCompare(b));
}
export function dailyRequiredSets(day=gameDateKey()) {
  const ids=releasedRunSets(day).slice(0,policy.daily_guaranteed_latest);
  if(ids.length!==policy.daily_guaranteed_latest)throw Error('Not enough released sets for the Daily.');
  return ids;
}
export function dailySetWeight(setId,version=DRAFT_RUN_SELECTION_VERSION,day=gameDateKey()) {
  let rank=(isEightPickVersion(version)?releasedRunSets(day):REGULAR_SET_ORDER).indexOf(setId);
  if(rank<0)return 1;
  for(const tier of (isEightPickVersion(version)?policy.daily_weight_tiers:policy.previous_daily_weight_tiers)){if(rank<tier.count)return tier.weight;rank-=tier.count;}
  return 1;
}

export function chooseRunSet(setIds,random,daily=false,version=DRAFT_RUN_SELECTION_VERSION,day=gameDateKey()) {
  if(!setIds.length)return undefined;
  const weights=setIds.map(s=>daily?dailySetWeight(s,version,day):1);
  let ticket=random()*weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<setIds.length;i++){ticket-=weights[i];if(ticket<0)return setIds[i];}
  return setIds.at(-1);
}

export function runDifficultyBands(random,version=DRAFT_RUN_SELECTION_VERSION) {
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  return isEightPickVersion(version)
    ? [...shuffle(['easy','medium','medium','medium','hard']),...shuffle(['medium','medium','hard'])]
    : [...shuffle(['easy','medium','medium','medium','medium','hard']),...shuffle(['medium','medium','hard','hard'])];
}

// Match each required set to a distinct feasible round before drawing packs.
// This avoids a late forced set colliding with an unavailable band/window.
// Reserving those sets prevents the optional draws consuming their sources.
export function requiredSetRounds(groups,bands,windows,random,required=[]) {
  const slots=Array.from({length:windows.length},(_,i)=>i);
  if(!required.length)return new Map();
  for(let i=slots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
  const assignment=new Map();
  const available=(set,round)=>groups.some(g=>g.set_id===set&&g.n>0&&g.band===bands[round]&&g.pick_number>=windows[round][0]&&g.pick_number<=windows[round][1]);
  const place=i=>{
    if(i===required.length)return true;
    for(const round of slots)if(!assignment.has(round)&&available(required[i],round)){
      assignment.set(round,required[i]);if(place(i+1))return true;assignment.delete(round);
    }
    return false;
  };
  if(!place(0))throw Object.assign(new Error('The latest released sets cannot form a complete Daily. Please try again later.'),{status:503});
  return assignment;
}
