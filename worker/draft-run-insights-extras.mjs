// Drafting Insights follow-up: server-only, deterministic summaries of the
// already owner-scoped, first-encounter normalized rows. No raw history leaves.
import {safeCardImageUrl} from '../card-image-policy.mjs';
export const DNA_VERSION='drafting-dna-v2';
export const JOURNEY_VERSION='drafting-journey-v2';
export const HIGHLIGHTS_VERSION='decision-highlights-v2';
// PROVISIONAL, unaudited qualification gates. One versioned source of truth;
// see docs/DRAFTING-DNA.md. Never describe these as validated percentiles.
export const DNA_QUALIFICATION=Object.freeze({
  version:DNA_VERSION,minimum_decisions:80,stability_recent_run:8,
  independent:Object.freeze({minimum_alternatives:40,alternative_share:.50,minimum_high_alternatives:20,strong_score:80}),
  sharpshooter:Object.freeze({high_score:90,minimum_high_share:.65,low_score:40,maximum_low_share:.10}),
  high_roller:Object.freeze({high_score:90,low_score:40,minimum_each_tail_share:.20}),
  steady_hand:Object.freeze({cohort_minimum:40,minimum_score:65,minimum_share:.85,low_score:40,maximum_low_share:.05}),
  depth:Object.freeze({minimum_per_phase:40,minimum_gap:10,early_regular:[1,3],late_regular:[6,8],early_cube:[2,4],late_cube:[7,9]}),
  rising:Object.freeze({minimum_per_window:40,minimum_gap:10}),
  deferred:Object.freeze(['trophy-twin','puzzle-solver','specialist']),
});
const WINDOW=40;
const round=n=>Math.round(n*10)/10;
const mean=rows=>rows.length?round(rows.reduce((n,r)=>n+r.score,0)/rows.length):null;
const pct=(count,total)=>total?round(100*count/total):0;
const version=r=>[r.scoring_version,r.selection_version,r.corpus_version].join('|');
const byTime=(a,b)=>a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id);
const evidence=(label,value)=>({label,value});

export function buildDraftingJourney(rows) {
  const oldest=[...rows].sort(byTime),windows=[],groups=[],hardCounts=[];
  for(const pick of oldest){
    const last=groups.at(-1);
    if(!last||last.key!==version(pick)||last.rows.length>=WINDOW)groups.push({key:version(pick),rows:[pick]});
    else last.rows.push(pick);
  }
  for(let i=0;i<groups.length;i++){
    const {key,rows:chunk}=groups[i],complete=chunk.length===WINDOW;
    windows.push({id:'window-'+i,from:chunk[0].answered_at.slice(0,10),
      to:chunk.at(-1).answered_at.slice(0,10),
      from_at:chunk[0].answered_at,to_at:chunk.at(-1).answered_at,count:chunk.length,
      average_score:chunk.length>=5?mean(chunk):null,complete,cohort:key});
    hardCounts.push(chunk.filter(r=>r.difficulty_band==='hard').length);
  }
  const complete=windows.filter(w=>w.complete);
  const compatible=complete.length>0&&complete.every(w=>w.cohort===complete[0].cohort);
  const best=compatible?[...complete].sort((a,b)=>b.average_score-a.average_score||a.from_at.localeCompare(b.from_at))[0]:null;
  const tail=windows.slice(-24),milestones=[];
  const stamp=(id,text,from,to,count,extra={})=>({id,date:to.to,from_at:from.from_at,to_at:to.to_at,text,count,...extra});
  const first=complete[0];
  if(first)milestones.push(stamp('first-forty','First completed 40-decision window',first,first,WINDOW));
  if(complete.length>=2)milestones.push(stamp('eighty','First two completed 40-decision windows',complete[0],complete[1],WINDOW*2));
  if(best&&complete.length>1)milestones.push(stamp('best-window',
    'Highest average among the comparable windows shown',best,best,WINDOW,{average_score:best.average_score}));
  const difficult=windows.findIndex((w,i)=>w.complete&&hardCounts[i]>=10);
  if(difficult>=0)milestones.push(stamp('hard-coverage',
    'First complete window with 10 or more hard-band decisions',windows[difficult],windows[difficult],
    WINDOW,{hard_decisions:hardCounts[difficult]}));
  milestones.sort((a,b)=>a.to_at.localeCompare(b.to_at)||a.id.localeCompare(b.id));
  return {version:JOURNEY_VERSION,eligible_decisions:rows.length,window_size:WINDOW,
    windows:tail,total_windows:windows.length,versions_comparable:compatible,
    best_window:best,milestones,limited:windows.length>tail.length,
    note:complete.length>1&&!compatible
      ?'Historical scoring, selection or card-pool versions differ. Do not rank windows across those boundaries.'
      :'Each point reflects originally awarded picks, not an estimate of skill improvement.'};
}

function candidate(id,title,family,description,n,metrics,strength) {
  return {id,title,evidence_family:family,summary:description,
    supporting_decisions:n,evidence:metrics,strength:round(strength)};
}
function qualifiedDNA(rows) {
  const all=[...rows],n=all.length,options=[];
  const c=DNA_QUALIFICATION;
  if(n<c.minimum_decisions)return options;
  const alternatives=all.filter(r=>!r.trophy_match);
  const highAlt=alternatives.filter(r=>r.score>=c.independent.strong_score).length;
  // Stored ranking support is model card-choice support (sometimes calibrated),
  // NOT P(the historical trophy drafter picked this card). Trophy Twin needs a
  // properly matched trophy baseline; neither this support nor raw match rate is one.
  if(alternatives.length>=c.independent.minimum_alternatives&&
      alternatives.length>=Math.ceil(n*c.independent.alternative_share)&&
      highAlt>=c.independent.minimum_high_alternatives){
    options.push(candidate('independent-thinker','The Independent Thinker','alternatives',
      'You often took a different card; several alternatives still earned strong original scores.',
      n,[evidence('Alternative selections',alternatives.length),
        evidence('Alternatives scoring 80+',highAlt)],
      pct(alternatives.length,n)-100*c.independent.alternative_share+pct(highAlt,alternatives.length)/2));
  }
  const high=all.filter(r=>r.score>=c.sharpshooter.high_score).length;
  const low=all.filter(r=>r.score<=c.sharpshooter.low_score).length;
  if(high>=Math.ceil(n*c.sharpshooter.minimum_high_share)&&low<=Math.floor(n*c.sharpshooter.maximum_low_share)){
    options.push(candidate('sharpshooter','The Sharpshooter','score-distribution',
      'Your recorded scores are frequently high, with relatively few low-score picks.',
      n,[evidence('Scores of 90+',high),evidence('Scores of 40 or below',low)],
      pct(high,n)-100*c.sharpshooter.minimum_high_share));
  }
  const variableHigh=all.filter(r=>r.score>=c.high_roller.high_score).length;
  const variableLow=all.filter(r=>r.score<=c.high_roller.low_score).length;
  if(variableHigh>=Math.ceil(n*c.high_roller.minimum_each_tail_share)&&
      variableLow>=Math.ceil(n*c.high_roller.minimum_each_tail_share)){
    options.push(candidate('high-roller','The High-Roller','score-variation',
      'Your recorded scores span both high and low ends of the scoring scale.',
      n,[evidence('Scores of 90+',variableHigh),evidence('Scores of 40 or below',variableLow)],
      Math.min(pct(variableHigh,n),pct(variableLow,n))-100*c.high_roller.minimum_each_tail_share));
  }
  // Exactly the same environment + scoring/selection/corpus + known difficulty
  // cohorts used by Architect/Closer. Every sufficiently sampled cohort must
  // pass, not just the pooled overall score distribution.
  const cohorts=new Map();
  for(const pick of all){
    if(!['easy','medium','hard'].includes(pick.difficulty_band))continue;
    const key=pick.environment+'|'+version(pick)+'|'+pick.difficulty_band;
    if(!cohorts.has(key))cohorts.set(key,[]);
    cohorts.get(key).push(pick);
  }
  const comparable=[...cohorts.values()].filter(a=>a.length>=c.steady_hand.cohort_minimum);
  if(comparable.length&&comparable.every(a=>a.filter(r=>r.score>=c.steady_hand.minimum_score).length>=
      Math.ceil(a.length*c.steady_hand.minimum_share)&&
      a.filter(r=>r.score<=c.steady_hand.low_score).length<=Math.floor(a.length*c.steady_hand.maximum_low_share))){
    const total=comparable.reduce((n,a)=>n+a.length,0);
    const minimumPct=Math.min(...comparable.map(a=>pct(a.filter(r=>r.score>=c.steady_hand.minimum_score).length,a.length)));
    options.push(candidate('steady-hand','The Steady Hand','score-distribution',
      'Within each sufficiently sampled comparable cohort, most choices earned at least 65 points with few very low scores.',
      total,[evidence('Comparable cohorts',comparable.length),
        evidence('Lowest cohort share scoring 65+',minimumPct+'%')],
      minimumPct-100*c.steady_hand.minimum_share));
  }
  const comparisons=[];
  for(const [key,cohort] of cohorts){
    const cube=cohort[0].environment==='powered-cube';
    const earlyRange=cube?c.depth.early_cube:c.depth.early_regular;
    const lateRange=cube?c.depth.late_cube:c.depth.late_regular;
    const early=cohort.filter(r=>r.pick_number>=earlyRange[0]&&r.pick_number<=earlyRange[1]);
    const late=cohort.filter(r=>r.pick_number>=lateRange[0]&&r.pick_number<=lateRange[1]);
    if(early.length>=c.depth.minimum_per_phase&&late.length>=c.depth.minimum_per_phase){
      const gap=round(mean(early)-mean(late));
      if(Math.abs(gap)>=c.depth.minimum_gap)comparisons.push({key,early:early.length,late:late.length,gap});
    }
  }
  comparisons.sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap)||a.key.localeCompare(b.key));
  if(comparisons.length){
    const best=comparisons[0],positive=best.gap>0;
    options.push(candidate(positive?'architect':'closer',positive?'The Architect':'The Closer','pick-depth',
      positive?'Your earlier source picks averaged higher scores within a compatible cohort.':
        'Your later source picks averaged higher scores within a compatible cohort.',
      best.early+best.late,[evidence('Early source picks',best.early),
        evidence('Later source picks',best.late),evidence('Recorded score gap',Math.abs(best.gap)+' points')],
      Math.abs(best.gap)-c.depth.minimum_gap));
  }
  for(const cohort of cohorts.values()){
    const ordered=[...cohort].sort((a,b)=>b.answered_at.localeCompare(a.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
    const floor=c.rising.minimum_per_window;
    if(ordered.length<floor*2)continue;
    const recent=ordered.slice(0,floor),previous=ordered.slice(floor,floor*2);
    const delta=round(mean(recent)-mean(previous));
    if(delta>=c.rising.minimum_gap)options.push(candidate('rising-star','The Rising Star','time-trend',
      'Your latest and preceding 40 recorded picks have different averages within a comparable cohort.',
      floor*2,[evidence('Recent 40 average',mean(recent)),evidence('Previous 40 average',mean(previous)),
        evidence('Recorded difference',delta+' points')],delta-c.rising.minimum_gap));
  }
  return options;
}
export function buildDraftingDNA(rows) {
  const all=[...rows].sort(byTime),n=all.length,c=DNA_QUALIFICATION;
  const previous=all.slice(0,Math.max(0,n-c.stability_recent_run));
  const stable=new Set(qualifiedDNA(previous).map(item=>item.id));
  const ranked=qualifiedDNA(all).filter(item=>stable.has(item.id)).sort((a,b)=>b.strength-a.strength||
    b.supporting_decisions-a.supporting_decisions||a.id.localeCompare(b.id));
  const picked=[],families=new Set();
  for(const item of ranked){
    if(families.has(item.evidence_family))continue;
    families.add(item.evidence_family);picked.push(item);
    if(picked.length===3)break;
  }
  const picks_needed=n<c.minimum_decisions?c.minimum_decisions-n:null;
  const reason=picks_needed!==null?'Complete the provisional 80-decision sample floor.':
    'The sample floor is met; another supported, stable and distinct qualification gate is needed.';
  const clean=x=>{if(!x)return {status:'emerging',label:'Trait still developing',picks_needed,reason};
    const {strength,...publicItem}=x;return {status:'qualified',...publicItem};};
  return {schema_version:DNA_VERSION,status:picked.length?'ready':'emerging',
    scope:'all-eligible-history',eligible_decisions:n,picks_needed,
    ...(picked.length?{}:{reason}),primary:picked[0]?clean(picked[0]):null,
    ...(picked.length?{}:{primary_emerging:clean(null)}),
    secondary:[clean(picked[1]),clean(picked[2])],
    note:'Provisional gates describe recorded decisions, not validated skill ranks. Traits must qualify both now and before the latest eight eligible decisions.'};
}

const highlightRow=r=>({session_id:r.session_id,round:r.round,puzzle_id:r.puzzle_id,
  set_id:r.set_id,environment:r.environment,pick_number:r.pick_number,
  date:r.answered_at.slice(0,10),score:r.score,trophy_match:r.trophy_match,
  selection_kind:r.trophy_match?'trophy-match':'alternative'});
function selectVariety(rows,limit,already=new Set()) {
  const chosen=[],sets=new Set(),positions=new Set();
  const remaining=rows.filter(r=>!already.has(r.puzzle_id)&&r.session_id&&Number.isInteger(r.round)&&r.round>=1&&r.round<=8);
  while(chosen.length<limit&&remaining.length){
    let bestIndex=0,bestBonus=-1;
    for(let i=0;i<remaining.length;i++){
      const r=remaining[i],bonus=(sets.has(r.set_id)?0:2)+(positions.has(r.pick_number)?0:1);
      if(bonus>bestBonus){bestBonus=bonus;bestIndex=i;if(bonus===3)break;}
    }
    const picked=remaining.splice(bestIndex,1)[0];
    chosen.push(highlightRow(picked));already.add(picked.puzzle_id);
    sets.add(picked.set_id);positions.add(picked.pick_number);
  }
  return chosen;
}
export function selectInsightHighlights(rows,{page=1}={}) {
  if(!Number.isInteger(page)||page<1||page>2)
    throw Object.assign(new Error('Only the first two highlight pages are available.'),{status:400});
  const valid=rows.filter(r=>r.session_id&&r.puzzle_id&&r.selected_id&&r.historical_id&&
    r.set_id&&Number.isInteger(r.round)&&r.round>=1&&r.round<=8);
  const strong=valid.filter(r=>!r.trophy_match&&r.score>=80)
    .sort((a,b)=>b.score-a.score||a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const tough=valid.filter(r=>r.trophy_match&&r.difficulty_band==='hard')
    .sort((a,b)=>a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const low=valid.filter(r=>!r.trophy_match&&r.score<=60)
    .sort((a,b)=>a.score-b.score||a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const seen=new Set(),bestPages=[];
  for(let i=0;i<2;i++)bestPages.push([...selectVariety(strong,3,seen),...selectVariety(tough,3,seen)]);
  const missesPages=[selectVariety(low,6,seen),selectVariety(low,6,seen)];
  return {schema_version:HIGHLIGHTS_VERSION,page,best:bestPages[page-1],misses:missesPages[page-1],
    has_more:{best:page===1&&bestPages[1].length>0,misses:page===1&&missesPages[1].length>0},
    note:'Best Calls and Biggest Misses reflect originally awarded scores, not objectively correct or incorrect strategic decisions.'};
}

const safeCard=c=>c&&typeof c==='object'&&typeof c.id==='string'?{
  id:c.id,name:String(c.name||'Unknown card').slice(0,140),
  image_url:safeCardImageUrl(c.image_url),
  mana_cost:typeof c.mana_cost==='string'?c.mana_cost.slice(0,60):null,
  rarity:typeof c.rarity==='string'?c.rarity.slice(0,40):null,
}:null;
export function publicLockedDecision(answer,extra={}) {
  if(!answer||typeof answer!=='object'||!answer.puzzle||!Array.isArray(answer.puzzle.candidates))return null;
  const original=answer.puzzle,candidates=original.candidates.map(safeCard).filter(Boolean).slice(0,20);
  const byId=id=>candidates.find(c=>c.id===id)||null;
  const selected=byId(answer.selectedId),trophy=byId(answer.historicalId);
  if(!selected||!trophy||!Number.isInteger(Number(answer.score)))return null;
  const prev=Array.isArray(original.prior_picks)?original.prior_picks.map(safeCard).filter(Boolean).slice(0,24):[];
  const ranking=Array.isArray(answer.ranking)?answer.ranking.slice(0,20).map(r=>({
    id:String(r.id||''),name:String(r.name||'').slice(0,140),
    score:Number.isFinite(Number(r.score))?Number(r.score):null,
    support:Number.isFinite(Number(r.support))?Number(r.support):null,
  })):[];
  const trophyFacts=answer.trophyDrafter&&typeof answer.trophyDrafter==='object'?{
    record:/^7[–-][012]$/.test(String(answer.trophyDrafter.record||''))?String(answer.trophyDrafter.record):null,
    win_rate:answer.trophyDrafter.winRate!=null&&Number.isFinite(Number(answer.trophyDrafter.winRate))?
      Math.max(0,Math.min(100,Number(answer.trophyDrafter.winRate))):null,
  }:null;
  return {set_id:String(original.set_id||'').slice(0,60),pick_number:Number(original.pick_number)||null,
    score:Number(answer.score),trophy_match:answer.historicalMatch===true,
    selected,trophy,candidates,prior_picks:prev,ranking,
    trophy_drafter:trophyFacts,...extra};
}
