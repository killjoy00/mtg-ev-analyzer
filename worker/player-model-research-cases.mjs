// Private, read-only research sampler for source-distinct Pack One decisions.
// Only aggregate votes are read; no player identity or production mutation.
// This is NOT a scoring model, correctness oracle or independently adjudicated benchmark.
export const RESEARCH_CORPUS='elite-trophy-colour-stage-v10';
export const RESEARCH_MIN_CHOICES=50;
export const RESEARCH_MAX_PUZZLES=1000;
export const RESEARCH_CASES_SQL=`
WITH votes AS MATERIALIZED (
  SELECT environment,puzzle_id,selected_id,count(*)::int votes
  FROM draft_run_source_measurements
  WHERE first_seen_at>=($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND first_seen_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND run_type='daily' AND observed AND NOT is_qa AND first_encounter AND outcome='pick'
  GROUP BY environment,puzzle_id,selected_id
), eligible AS (
  SELECT environment,puzzle_id,sum(votes)::int n,jsonb_object_agg(selected_id,votes) votes
  FROM votes GROUP BY environment,puzzle_id HAVING sum(votes)>=$3::int
)
SELECT e.environment,e.puzzle_id,e.n,e.votes,p.set_id,p.pick_number,
  p.source_draft_hash,p.corpus_version,
  p.payload->'prior_picks' prior_picks,p.payload->'candidates' candidates,
  p.payload->>'historical_pick_id' historical_pick_id
FROM eligible e JOIN draft_run_verified_puzzles p USING(puzzle_id)
WHERE p.corpus_version=$4::text
ORDER BY e.environment,e.puzzle_id
LIMIT 1001
`;

const FORMATS=['latest','mixed','powered-cube'];
const STAGES=['early','middle','late'];
const COLOURS='WUBRG';
const ID=/^[a-z0-9-]{1,120}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const land=c=>/\bLand\b/i.test(String(c?.type_line||''));
// FNV-1a: stable ordering only, not a security or anonymization mechanism.
function stableHash(s) {
  let h=2166136261;
  for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);
  return h>>>0;
}
export function stageForPick(pick) {
  return pick<=3?'early':pick<=6?'middle':'late';
}
// Only ordinary printed costs are understood. Multi-face, phyrexian, hybrid
// and ambiguous mana symbols stay UNKNOWN; never infer they are colorless.
export function simpleCastColors(card) {
  if(land(card))return null; // lands need produced-mana rules metadata
  const cost=card?.mana_cost;
  if(typeof cost!=='string'||!cost)return null;
  const tokens=[...cost.matchAll(/\{([^}]+)\}/g)].map(x=>x[1]);
  if(!tokens.length||tokens.join('').length+2*tokens.length!==cost.length)return null;
  const required=new Set();
  for(const t of tokens){
    if(COLOURS.includes(t)&&t.length===1)required.add(t);
    else if(!/^(?:\d+|X|C|S)$/.test(t))return null;
  }
  return [...required].sort();
}
export function strongPoolColour(prior) {
  const counts={W:0,U:0,B:0,R:0,G:0};
  for(const card of prior) {
    const colors=simpleCastColors(card);
    if(colors?.length===1)counts[colors[0]]++;
  }
  const ordered=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return ordered[0][1]>=3&&ordered[0][1]-ordered[1][1]>=2?ordered[0][0]:null;
}
export function wilsonLower95(k,n) {
  if(!Number.isInteger(k)||!Number.isInteger(n)||n<=0||k<0||k>n)throw Error('Invalid vote count');
  const z=1.959963984540054,p=k/n,z2=z*z;
  return (p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);
}
function safeImage(value) {
  if(typeof value!=='string')return null;
  try {const u=new URL(value);
    if(u.protocol==='https:'&&u.hostname==='cards.scryfall.io'&&!u.username&&!u.password
      &&/^\/(?:normal|large|png)\/front\//.test(u.pathname))return u.toString();
  } catch{}
  return null;
}
function cardView(c) {
  return {id:c.id,name:c.name,mana_cost:typeof c.mana_cost==='string'?c.mana_cost:null,
    type_line:typeof c.type_line==='string'?c.type_line:null,image_url:safeImage(c.image_url)};
}
function completeCase(row) {
  if(!FORMATS.includes(row.environment)||!ID.test(row.puzzle_id)||!ID.test(row.historical_pick_id)
    ||!Number.isInteger(Number(row.n))||Number(row.n)<RESEARCH_MIN_CHOICES
    ||!Number.isInteger(Number(row.pick_number))||Number(row.pick_number)<1
    ||Number(row.pick_number)>15||typeof row.source_draft_hash!=='string'||!row.source_draft_hash
    ||!Array.isArray(row.candidates)||row.candidates.length<2
    ||!Array.isArray(row.prior_picks)||row.prior_picks.length!==Number(row.pick_number)-1
    ||!row.votes||typeof row.votes!=='object'||Array.isArray(row.votes))return null;
  const n=Number(row.n), cards=row.candidates;
  const ids=cards.map(c=>c?.id);
  if(ids.some(x=>!ID.test(x))||new Set(ids).size!==ids.length||!ids.includes(row.historical_pick_id)
    ||cards.some(c=>!c||typeof c.name!=='string'||!c.name
      ||!finite(c.model_probability)||c.model_probability<0||c.model_probability>1))return null;
  const sum=cards.reduce((acc,c)=>acc+c.model_probability,0);
  if(Math.abs(sum-1)>0.01)return null;
  const votes=new Map();
  for(const [id,v] of Object.entries(row.votes)){
    if(!ids.includes(id)||!Number.isInteger(Number(v))||Number(v)<=0)return null;
    votes.set(id,Number(v));
  }
  if([...votes.values()].reduce((a,b)=>a+b,0)!==n)return null;
  const playerRank=[...cards].sort((a,b)=>(votes.get(b.id)||0)-(votes.get(a.id)||0)||a.id.localeCompare(b.id));
  const modelRank=[...cards].sort((a,b)=>b.model_probability-a.model_probability||a.id.localeCompare(b.id));
  if((votes.get(playerRank[0].id)||0)===(votes.get(playerRank[1].id)||0)
    ||modelRank[0].model_probability===modelRank[1].model_probability)return null;
  const player=playerRank[0],model=modelRank[0],selectedVotes=votes.get(player.id)||0;
  const strongColour=strongPoolColour(row.prior_picks);
  const playerColors=simpleCastColors(player),modelColors=simpleCastColors(model);
  const tags=[];
  if(land(player)!==land(model))tags.push('land-vs-nonland');
  if(land(player)&&land(model))tags.push('land-vs-land');
  if(strongColour&&playerColors?.length===1&&playerColors[0]===strongColour
    &&modelColors?.length&&modelColors.some(c=>c!==strongColour))tags.push('pool-color-tension');
  if(!land(player)&&!land(model))tags.push('nonland-card-value-or-synergy');
  if(!playerColors||!modelColors)tags.push('mana-metadata-incomplete-or-land');
  const win=wilsonLower95(selectedVotes,n);
  const supportGap=win-player.model_probability;
  return {
    environment:row.environment,caseSource:row.source_draft_hash,puzzleId:row.puzzle_id,
    setId:row.set_id,pick:Number(row.pick_number),stage:stageForPick(Number(row.pick_number)),n,
    player,model,trophyId:row.historical_pick_id,votes,
    prior:row.prior_picks,cards,playerVotes:selectedVotes,playerShare:selectedVotes/n,
    wilsonLower:win,supportGap,disagree:player.id!==model.id,tags,
  };
}
function sortTarget(a,b) {
  return b.supportGap-a.supportGap||b.playerShare-a.playerShare||b.n-a.n
    ||a.puzzleId.localeCompare(b.puzzleId);
}
function sortControl(a,b) {
  return stableHash(a.environment+':'+a.puzzleId)-stableHash(b.environment+':'+b.puzzleId)
    ||a.puzzleId.localeCompare(b.puzzleId);
}
function sampleCases(valid) {
  const selected=[],usedSources=new Set(),picked=new Set();
  const push=c=>{if(usedSources.has(c.caseSource)||picked.has(c.puzzleId))return false;
    usedSources.add(c.caseSource);picked.add(c.puzzleId);selected.push(c);return true;};
  // Frozen design: up to six high-gap cases and three deterministic controls
  // in each environment × real-source pick-stage cell; selected once per draft.
  for(const environment of FORMATS)for(const stage of STAGES){
    const group=valid.filter(c=>c.environment===environment&&c.stage===stage);
    let n=0;
    for(const c of group.filter(c=>c.disagree&&c.supportGap>=0.10)
      .sort(sortTarget)){if(push(c)&&++n===6)break;}
    n=0;
    for(const c of group.filter(c=>!picked.has(c.puzzleId))
      .sort(sortControl)){if(push(c)&&++n===3)break;}
  }
  return selected.sort((a,b)=>stableHash(a.environment+':'+a.puzzleId)
    -stableHash(b.environment+':'+b.puzzleId)||a.puzzleId.localeCompare(b.puzzleId));
}
export function buildModelResearchCases(rows,{view='blind'}={}) {
  if(!['blind','diagnosis'].includes(view))throw Error('Invalid research view');
  if(!Array.isArray(rows)||rows.length>RESEARCH_MAX_PUZZLES)throw Error('Research window exceeds the 1000-puzzle safety limit; narrow the dates');
  const valid=rows.filter(r=>r.corpus_version===RESEARCH_CORPUS).map(completeCase).filter(Boolean);
  const selected=sampleCases(valid);
  const cases=selected.map((c,i)=>{
    const review_id='R'+String(i+1).padStart(3,'0');
    const base={review_id,environment:c.environment,set_id:c.setId,pick_number:c.pick,
      prior_picks:c.prior.map(cardView),
      candidates:[...c.cards].sort((a,b)=>stableHash(review_id+':'+a.id)
        -stableHash(review_id+':'+b.id)||a.id.localeCompare(b.id)).map(cardView)};
    if(view==='blind')return base;
    return {...base,sample_size:c.n,player_favorite:{id:c.player.id,name:c.player.name,
        votes:c.playerVotes,share:Math.round(c.playerShare*1000)/1000,
        model_probability:c.player.model_probability},
      model_favorite:{id:c.model.id,name:c.model.name,
        probability:c.model.model_probability},trophy_pick_id:c.trophyId,
      player_favorite_trophy:c.player.id===c.trophyId,
      model_favorite_trophy:c.model.id===c.trophyId,
      wilson_lower95:Math.round(c.wilsonLower*1000)/1000,
      lower_bound_minus_model_probability:Math.round(c.supportGap*1000)/1000,
      candidate_diagnostics:c.cards.map(x=>({id:x.id,votes:c.votes.get(x.id)||0,
        model_probability:x.model_probability})),tags:c.tags,
      cohort:'observational; first-time Daily picks; not an adjudicated truth label'};
  });
  return {view,corpus_version:RESEARCH_CORPUS,min_choices:RESEARCH_MIN_CHOICES,
    qualified_puzzles:valid.length,review_cases:cases.length,cases};
}
