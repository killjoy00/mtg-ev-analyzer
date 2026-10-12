// Drafting Insights follow-up: server-only, deterministic summaries of the
// already owner-scoped, first-encounter normalized rows. No raw history leaves.
export const DNA_VERSION='drafting-dna-v1';
export const JOURNEY_VERSION='drafting-journey-v1';
export const HIGHLIGHTS_VERSION='decision-highlights-v1';
const WINDOW=40;
const round=n=>Math.round(n*10)/10;
const mean=rows=>rows.length?round(rows.reduce((n,r)=>n+r.score,0)/rows.length):null;
const pct=(count,total)=>total?round(100*count/total):0;
const version=r=>[r.scoring_version,r.selection_version,r.corpus_version].join('|');
const byTime=(a,b)=>a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id);
const evidence=(label,value)=>({label,value});

export function buildDraftingJourney(rows) {
  const oldest=[...rows].sort(byTime),windows=[],groups=[];
  for(const pick of oldest){
    const last=groups.at(-1);
    if(!last||last.key!==version(pick)||last.rows.length>=WINDOW)groups.push({key:version(pick),rows:[pick]});
    else last.rows.push(pick);
  }
  for(let i=0;i<groups.length;i++){
    const {key,rows:chunk}=groups[i],complete=chunk.length===WINDOW;
    windows.push({id:'window-'+i,from:chunk[0].answered_at.slice(0,10),
      to:chunk.at(-1).answered_at.slice(0,10),count:chunk.length,
      average_score:chunk.length>=5?mean(chunk):null,complete,cohort:key});
  }
  // A high score across unrelated corpus/scoring versions is not an all-time
  // "best". Name a best window only when the completed windows are compatible.
  const complete=windows.filter(w=>w.complete);
  const compatible=complete.length>0&&complete.every(w=>w.cohort===complete[0].cohort);
  const best=compatible?[...complete].sort((a,b)=>b.average_score-a.average_score||a.from.localeCompare(b.from))[0]:null;
  const tail=windows.slice(-24);
  const milestones=[];
  const first=complete[0];
  if(first)milestones.push({id:'first-forty',date:first.to,
    text:'First completed 40-decision window',count:WINDOW});
  if(complete.length>=2)milestones.push({id:'eighty',date:complete[1].to,
    text:'First two completed 40-decision windows',count:WINDOW*2});
  if(best&&complete.length>1)milestones.push({id:'best-window',date:best.to,
    text:'Highest average among the comparable windows shown',count:WINDOW,
    average_score:best.average_score});
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
export function buildDraftingDNA(rows) {
  const all=[...rows],n=all.length,options=[],matched=all.filter(r=>r.trophy_match);
  const alternatives=all.filter(r=>!r.trophy_match);
  const highAlt=alternatives.filter(r=>r.score>=80).length;
  // Thresholds are descriptive evidence gates, not peer percentiles or
  // calibrated "elite skill" rankings. Defer Puzzle Solver/Specialist.
  if(n>=80&&matched.length>=Math.ceil(n*.65)){
    const rate=pct(matched.length,n);
    options.push(candidate('trophy-twin','The Trophy Twin','alignment',
      'Your recorded selections frequently matched the original trophy picks.',
      n,[evidence('Matched trophy picks',matched.length),evidence('Match rate',rate+'%')],
      rate-65));
  }
  if(n>=80&&alternatives.length>=40&&alternatives.length>=Math.ceil(n*.5)&&highAlt>=20){
    options.push(candidate('independent-thinker','The Independent Thinker','alternatives',
      'You often took a different card; several alternatives still earned strong original scores.',
      n,[evidence('Alternative selections',alternatives.length),
        evidence('Alternatives scoring 80+',highAlt)],
      pct(alternatives.length,n)-50+pct(highAlt,alternatives.length)/2));
  }
  const high=all.filter(r=>r.score>=90).length,low=all.filter(r=>r.score<=40).length;
  if(n>=80&&high>=Math.ceil(n*.65)&&low<=Math.floor(n*.1)){
    options.push(candidate('sharpshooter','The Sharpshooter','score-quality',
      'Your recorded scores are frequently high, with relatively few low-score picks.',
      n,[evidence('Scores of 90+',high),evidence('Scores of 40 or below',low)],
      pct(high,n)-65));
  }
  if(n>=80&&high>=Math.ceil(n*.2)&&low>=Math.ceil(n*.2)){
    options.push(candidate('high-roller','The High-Roller','score-variation',
      'Your recorded scores span both high and low ends of the scoring scale.',
      n,[evidence('Scores of 90+',high),evidence('Scores of 40 or below',low)],
      Math.min(pct(high,n),pct(low,n))-20));
  }
  if(n>=80&&low<=Math.floor(n*.05)&&all.filter(r=>r.score>=65).length>=Math.ceil(n*.85)){
    options.push(candidate('steady-hand','The Steady Hand','consistency',
      'Most recorded choices earned at least 65 points, with few very low scores.',
      n,[evidence('Scores of 65+',all.filter(r=>r.score>=65).length),
        evidence('Scores of 40 or below',low)],pct(all.filter(r=>r.score>=65).length,n)-85));
  }
  // Compare source picks only within the same format, scoring, selection and
  // corpus cohort. A cube's P1P2 cannot be treated as another format's P1P2.
  const cohorts=new Map();
  for(const pick of all){
    const key=pick.environment+'|'+version(pick);
    if(!cohorts.has(key))cohorts.set(key,[]);
    cohorts.get(key).push(pick);
  }
  const comparisons=[];
  for(const [key,cohort] of cohorts){
    const early=cohort.filter(r=>r.environment==='powered-cube'
      ?r.pick_number>=2&&r.pick_number<=4:r.pick_number>=1&&r.pick_number<=3);
    const late=cohort.filter(r=>r.environment==='powered-cube'
      ?r.pick_number>=7&&r.pick_number<=9:r.pick_number>=6&&r.pick_number<=8);
    if(early.length>=40&&late.length>=40){
      const gap=round(mean(early)-mean(late));
      if(Math.abs(gap)>=10)comparisons.push({key,early:early.length,late:late.length,gap});
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
      Math.abs(best.gap)-10));
  }
  for(const cohort of cohorts.values()){
    const ordered=[...cohort].sort((a,b)=>b.answered_at.localeCompare(a.answered_at));
    if(ordered.length<80)continue;
    const recent=ordered.slice(0,40),previous=ordered.slice(40,80);
    const delta=round(mean(recent)-mean(previous));
    if(delta>=10)options.push(candidate('rising-star','The Rising Star','time-trend',
      'Your most recent 40 scored picks averaged higher than the previous 40 in this comparable cohort.',
      80,[evidence('Recent 40 average',mean(recent)),evidence('Previous 40 average',mean(previous)),
        evidence('Recorded difference',delta+' points')],delta-10));
  }
  const ranked=options.sort((a,b)=>b.strength-a.strength||
    b.supporting_decisions-a.supporting_decisions||a.id.localeCompare(b.id));
  const picked=[],families=new Set();
  for(const item of ranked){
    if(families.has(item.evidence_family))continue;
    families.add(item.evidence_family);picked.push(item);
    if(picked.length===3)break;
  }
  const clean=x=>{if(!x)return {status:'emerging',label:'Trait still developing'};
    const {strength,...publicItem}=x;return {status:'qualified',...publicItem};};
  return {schema_version:DNA_VERSION,status:picked.length?'ready':'emerging',
    scope:'all-eligible-history',eligible_decisions:n,primary:picked[0]?clean(picked[0]):null,
    secondary:[clean(picked[1]),clean(picked[2])],
    note:'Labels describe recorded decisions. They are not validated skill rankings or the original drafter’s motives.'};
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
export function selectInsightHighlights(rows) {
  const valid=rows.filter(r=>r.session_id&&r.puzzle_id&&r.selected_id&&r.historical_id&&
    r.set_id&&Number.isInteger(r.round)&&r.round>=1&&r.round<=8);
  const strong=valid.filter(r=>!r.trophy_match&&r.score>=80)
    .sort((a,b)=>b.score-a.score||a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const tough=valid.filter(r=>r.trophy_match&&r.difficulty_band==='hard')
    .sort((a,b)=>a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const low=valid.filter(r=>!r.trophy_match&&r.score<=60)
    .sort((a,b)=>a.score-b.score||a.answered_at.localeCompare(b.answered_at)||a.puzzle_id.localeCompare(b.puzzle_id));
  const seen=new Set();
  const best=[...selectVariety(strong,3,seen),...selectVariety(tough,3,seen)];
  const misses=selectVariety(low,6,seen);
  return {schema_version:HIGHLIGHTS_VERSION,best,misses,note:
    'Best Calls and Biggest Misses reflect originally awarded scores, not objectively correct or incorrect strategic decisions.'};
}

const safeCard=c=>c&&typeof c==='object'&&typeof c.id==='string'?{
  id:c.id,name:String(c.name||'Unknown card').slice(0,140),
  image_url:typeof c.image_url==='string'&&/^https:\/\//.test(c.image_url)?c.image_url:null,
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
