import policy from './data/selection-policy.json' with {type:'json'};

export const DRAFT_RUN_SELECTION_VERSION=policy.selection_version;
export const PREVIOUS_SELECTION_VERSION='balanced-v1';
export const SELECTABLE_ONLY_SETS=new Set(policy.selectable_only_sets);
export const REGULAR_SET_ORDER=Object.freeze(policy.regular_sets_newest_first);
export const maxRunPick=environment=>policy.max_pick[environment==='powered-cube'?'powered-cube':'mixed'];
export const eligibleRunPuzzle=p=>Number(p.pack_number??1)===1 && Number(p.pick_number)<=maxRunPick(p.set_id);
export const regularRunSet=setId=>setId!=='powered-cube'&&!SELECTABLE_ONLY_SETS.has(setId);

export function dailySetWeight(setId) {
  let rank=REGULAR_SET_ORDER.indexOf(setId);
  if(rank<0)return 1;
  for(const tier of policy.daily_weight_tiers){if(rank<tier.count)return tier.weight;rank-=tier.count;}
  return 1;
}

export function chooseRunSet(setIds,random,daily=false) {
  if(!setIds.length)return undefined;
  const weights=setIds.map(s=>daily?dailySetWeight(s):1);
  let ticket=random()*weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<setIds.length;i++){ticket-=weights[i];if(ticket<0)return setIds[i];}
  return setIds.at(-1);
}

export function runDifficultyBands(random) {
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  return [...shuffle(['easy','medium','medium','medium','medium','hard']),...shuffle(['medium','medium','hard','hard'])];
}
