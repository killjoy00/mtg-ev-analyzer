import {buildDraftingJourney,buildDraftingDNA,selectInsightHighlights,publicLockedDecision} from './draft-run-insights-extras.mjs';
// Private My Pack One decision insights. Original stored answer score is authoritative.
export const INSIGHTS_SQL="WITH recent_sessions AS MATERIALIZED (\n  SELECT s.id,s.environment,s.answers,s.scoring_version,s.selection_version,s.corpus_version\n  FROM draft_run_sessions s JOIN players p ON p.id=s.player_id\n  WHERE s.player_id=$1::uuid AND NOT s.measurement_qa\n    AND p.display_name !~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)'\n    AND jsonb_array_length(s.puzzle_ids)=8\n    AND s.selection_version IN ('eight-pick-v3','eight-pick-v4')\n  ORDER BY s.created_at DESC,s.id DESC\n  LIMIT 1000\n)\nSELECT s.id::text session_id,s.environment,s.scoring_version,s.selection_version,s.corpus_version,\n       picked.ordinality::int answer_round,\n       picked.answer->>'selectedId' selected_id,picked.answer->>'historicalId' historical_id,\n       picked.answer->>'selectedName' selected_name,picked.answer->>'historicalName' historical_name,\n       picked.answer->'puzzle'->>'set_id' set_id,\n       picked.answer->'puzzle'->>'puzzle_id' puzzle_id,\n       (picked.answer->'puzzle'->>'pick_number')::int pick_number,\n       (picked.answer->>'score')::int score,\n       (picked.answer->>'historicalMatch')::boolean trophy_match,\n       o.answered_at,COALESCE(r.band,'unknown') difficulty_band\nFROM recent_sessions s\nCROSS JOIN LATERAL jsonb_array_elements(s.answers) WITH ORDINALITY picked(answer,ordinality)\nJOIN draft_run_decision_observations o\n  ON o.session_id=s.id AND o.round=picked.ordinality::int AND o.outcome='pick'\n  AND o.puzzle_id=(picked.answer->'puzzle'->>'puzzle_id')\nLEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=o.puzzle_id AND r.difficulty_version='support-ratio-v1'\nWHERE jsonb_typeof(picked.answer->'puzzle')='object'\n  AND picked.answer->>'score' ~ '^(100|[0-9]{1,2})$'\n  AND picked.answer->'puzzle'->>'pick_number' ~ '^[0-9]{1,2}$'\n  AND picked.answer->>'historicalMatch' IN ('true','false')\nORDER BY o.answered_at ASC,s.id,picked.ordinality\nLIMIT 8000";
export const INSIGHTS_SESSION_LIMIT=1000;
export const INSIGHTS_GROUP_MIN=5;
export const INSIGHTS_MONTH_MIN=10;
export const INSIGHTS_UNLOCK_MIN=8;
export const INSIGHTS_COMPARISON_MIN=40;
export const INSIGHTS_OBSERVATION_GAP=10;
export const INSIGHTS_WINDOWS=[40,40];
export const INSIGHTS_ENVIRONMENTS=Object.freeze(['mixed','latest','powered-cube']);
export const INSIGHTS_PERIODS=Object.freeze(['all','90d','365d']);

const LABELS=Object.freeze({mixed:'Mixed',latest:'Latest Set','powered-cube':'Powered Cube'});
const BANDS=Object.freeze(['easy','medium','hard','unknown']);
const monthFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit'});
const round=n=>Math.round(n*10)/10;

export function validateInsightsFilters({environment='mixed',period='all'}={}) {
  const selected=environment||'mixed',window=period||'all';
  if(!INSIGHTS_ENVIRONMENTS.includes(selected)||!INSIGHTS_PERIODS.includes(window))
    throw Object.assign(new Error('Choose a valid Insights environment and period.'),{status:400});
  return {environment:selected,period:window};
}

function monthKey(value) {
  const parts=monthFormatter.formatToParts(new Date(value));
  return parts.find(x=>x.type==='year').value+'-'+parts.find(x=>x.type==='month').value;
}

function countSummary(rows,minimum=INSIGHTS_GROUP_MIN) {
  const count=rows.length;
  const total=rows.reduce((acc,row)=>acc+row.score,0);
  const trophy=rows.filter(row=>row.trophy_match).length;
  return {count,average_score:count>=minimum?round(total/count):null,
    trophy_match_pct:count>=minimum?round(100*trophy/count):null};
}
const oldestNewest=rows=>rows.length?{
  from:rows.at(-1).answered_at.slice(0,10),to:rows[0].answered_at.slice(0,10),
}:null;

function grouped(rows,key,minimum=INSIGHTS_GROUP_MIN) {
  const groups=new Map();
  for(const row of rows){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
  return [...groups].map(([value,items])=>({value,...countSummary(items,minimum)}));
}

function normalise(rows) {
  const seen=new Set(),answers=[];
  // Query is ascending by locked-answer time, so the first occurrence wins,
  // even if it came from a now-merged practice/creator/duplicate Daily.
  const sorted=[...rows].sort((a,b)=>{
    const t=x=>x.answered_at==null?Infinity:new Date(x.answered_at).getTime();
    const ta=t(a),tb=t(b);
    return (Number.isFinite(ta)?ta:Infinity)-(Number.isFinite(tb)?tb:Infinity)||
      String(a.session_id).localeCompare(String(b.session_id));
  });
  for(const row of sorted){
    const id=String(row.puzzle_id||'');
    const score=Number(row.score),pick=Number(row.pick_number),when=row.answered_at==null?NaN:new Date(row.answered_at).getTime();
    if(!id||!Number.isInteger(score)||score<0||score>100||!Number.isInteger(pick)||pick<1||pick>11||
      !Number.isFinite(when)||!INSIGHTS_ENVIRONMENTS.includes(row.environment)||
      ![true,false,'true','false','t','f'].includes(row.trophy_match)||seen.has(id))continue;
    seen.add(id);
    answers.push({
      puzzle_id:id,session_id:String(row.session_id),environment:row.environment,
      round:Number(row.answer_round),selected_id:String(row.selected_id||''),
      historical_id:String(row.historical_id||''),
      selected_name:String(row.selected_name||''),historical_name:String(row.historical_name||''),
      set_id:String(row.set_id||''),
      score,pick_number:pick,trophy_match:row.trophy_match===true||row.trophy_match==='true'||row.trophy_match==='t',
      difficulty_band:BANDS.includes(row.difficulty_band)?row.difficulty_band:'unknown',
      answered_at:new Date(when).toISOString(),
      scoring_version:String(row.scoring_version||''),selection_version:String(row.selection_version||''),
      corpus_version:String(row.corpus_version||''),
    });
  }
  return answers.sort((a,b)=>b.answered_at.localeCompare(a.answered_at)||a.session_id.localeCompare(b.session_id));
}

function comparison(rows,labelA,labelB,a,b,id,note='') {
  if(a.count<INSIGHTS_COMPARISON_MIN||b.count<INSIGHTS_COMPARISON_MIN||
    a.average_score===null||b.average_score===null)return null;
  const gap=round(a.average_score-b.average_score);
  if(Math.abs(gap)<INSIGHTS_OBSERVATION_GAP)return null;
  return {id,count:Math.min(a.count,b.count),gap:Math.abs(gap),
    text:labelA+' averaged '+Math.abs(gap).toFixed(1)+' points '+(gap>0?'higher':'lower')+
    ' than '+labelB+' ('+a.count+' vs '+b.count+' decisions).'+(note?' '+note:'')};
}

// Chart-ready, private, bounded aggregation. No raw decision rows leave the server.
export function aggregateDraftRunInsights(source,{environment='mixed',period='all',now=new Date()}={}) {
  const filter=validateInsightsFilters({environment,period});
  const all=normalise(Array.isArray(source)?source:[]);
  const current=now instanceof Date?now:new Date(now);
  const maxAge=period==='90d'?90:period==='365d'?365:Infinity;
  const cutoff=Number.isFinite(maxAge)?current.getTime()-maxAge*86400000:-Infinity;
  const eligible=all.filter(row=>new Date(row.answered_at).getTime()>=cutoff);
  const selected=eligible.filter(row=>row.environment===filter.environment);
  const total=selected.length;
  const depth=grouped(selected,r=>r.pick_number).sort((a,b)=>a.value-b.value)
    .map(({value,...result})=>({pick_number:value,label:'P1P'+value,...result}));
  const difficulty=BANDS.map(band=>({band,...countSummary(selected.filter(r=>r.difficulty_band===band))}))
    .filter(row=>row.count>0);
  const months=grouped(selected,row=>monthKey(row.answered_at),INSIGHTS_MONTH_MIN)
    .filter(row=>row.count>=INSIGHTS_MONTH_MIN)
    .sort((a,b)=>a.value.localeCompare(b.value))
    .map(({value,...rest})=>({month:value,...rest}));
  const formats=INSIGHTS_ENVIRONMENTS.map(value=>({environment:value,label:LABELS[value],
    ...countSummary(eligible.filter(r=>r.environment===value))}));
  const recent=selected.slice(0,40),prior=selected.slice(40,80);
  const progress=prior.length===40?{
    recent:{...countSummary(recent,40),...oldestNewest(recent)},
    previous:{...countSummary(prior,40),...oldestNewest(prior)},
    delta:round(countSummary(recent,40).average_score-countSummary(prior,40).average_score),
  }:null;
  const proposals=[];
  if(progress) {
    const result=comparison(selected,'Recent 40 picks','previous 40 picks',
      progress.recent,progress.previous,'progress','Recorded scores describe picks, not causation.');
    if(result)proposals.push(result);
  }
  // Only large cohorts may trigger copy; 5-answer chart groups remain descriptive.
  const goodPicks=depth.filter(p=>p.count>=40);
  if(goodPicks.length>=2){
    const higher=[...goodPicks].sort((a,b)=>b.average_score-a.average_score)[0];
    const lower=[...goodPicks].sort((a,b)=>a.average_score-b.average_score)[0];
    if(higher.pick_number!==lower.pick_number){
      const result=comparison(selected,higher.label,lower.label,higher,lower,'pick-depth');
      if(result)proposals.push(result);
    }
  }
  const goodBands=difficulty.filter(p=>p.count>=40&&p.band!=='unknown');
  if(goodBands.length>=2){
    const higher=[...goodBands].sort((a,b)=>b.average_score-a.average_score)[0];
    const lower=[...goodBands].sort((a,b)=>a.average_score-b.average_score)[0];
    if(higher.band!==lower.band){
      const result=comparison(selected,higher.band+' decisions',lower.band+' decisions',higher,lower,'difficulty',
        'The puzzle difficulty groups are different.');
      if(result)proposals.push(result);
    }
  }
  const main=formats.find(f=>f.environment===environment);
  for(const other of formats){
    if(other.environment===environment)continue;
    const result=comparison(selected,main.label+' drafts',other.label+' drafts',main,other,
      'format-'+other.environment,'The card pools differ between formats.');
    if(result)proposals.push(result);
  }
  proposals.sort((a,b)=>b.count-a.count||b.gap-a.gap||a.id.localeCompare(b.id));
  const observations=proposals.slice(0,3).map(({id,text})=>({id,text}));
  // DNA uses the complete bounded first-encounter history, not chart filters.
  const drafting_dna=buildDraftingDNA(all);
  const journey=buildDraftingJourney(selected);
  const highlights=selectInsightHighlights(selected);
  const versions={
    scoring:[...new Set(selected.map(r=>r.scoring_version))].sort(),
    selection:[...new Set(selected.map(r=>r.selection_version))].sort(),
    corpus:[...new Set(selected.map(r=>r.corpus_version))].sort(),
  };
  return {
    environment:filter.environment,period:filter.period,environment_label:LABELS[environment],
    eligible_decisions:total,unlocked:total>=INSIGHTS_UNLOCK_MIN,unlock_at:INSIGHTS_UNLOCK_MIN,
    total_eligible_decisions:eligible.length,unknown_difficulty:selected.filter(r=>r.difficulty_band==='unknown').length,
    pick_depth:depth,difficulty,months,formats,progress,observations,versions,
    drafting_dna,journey,highlights,
    range:oldestNewest(selected),session_limit:INSIGHTS_SESSION_LIMIT,
    methodology:'Original awarded pick scores; first answer to each puzzle in up to 1,000 recent eight-pick non-QA runs. '+
      'Pick numbers are real source pick positions. Group averages require 5 picks; months need 10; progress needs two sets of 40; '+
      'written comparisons need at least 40 per group and a 10-point gap. Historical card pools and models may differ.',
  };
}

// Bounded preview retrieval: at most twelve cards' source sessions, from
// this owner only. Candidate lists are never exposed through the summary.
export const INSIGHTS_PREVIEW_SQL=`SELECT id::text session_id,answers
FROM draft_run_sessions WHERE player_id=$1::uuid AND id=ANY($2::uuid[])
  AND NOT measurement_qa AND jsonb_array_length(puzzle_ids)=8
  AND selection_version IN ('eight-pick-v3','eight-pick-v4') LIMIT 12`;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function asAnswers(value) {
  if(Array.isArray(value))return value;
  try{return JSON.parse(value||'[]');}catch{return [];}
}
export async function loadDraftRunInsights(query,owner,filters={}) {
  const clean=validateInsightsFilters(filters);
  const rows=await query(INSIGHTS_SQL,[owner]);
  const result=aggregateDraftRunInsights(rows.rows,clean);
  const list=[...result.highlights.best,...result.highlights.misses];
  const ids=[...new Set(list.map(r=>r.session_id).filter(s=>UUID.test(s)))].slice(0,12);
  if(ids.length) {
    const selected=await query(INSIGHTS_PREVIEW_SQL,[owner,ids]);
    const indexed=new Map((selected.rows||[]).map(row=>[row.session_id,asAnswers(row.answers)]));
    for(const item of list) {
      const answer=indexed.get(item.session_id)?.[item.round-1];
      if(answer?.puzzle?.puzzle_id!==item.puzzle_id)continue;
      const decision=publicLockedDecision(answer);
      if(!decision)continue;
      item.preview={selected:decision.selected,trophy:decision.trophy};
    }
  }
  return result;
}

export const INSIGHTS_DECISION_SQL=`SELECT picked.answer,o.answered_at,s.scoring_version,s.corpus_version
FROM draft_run_sessions s
CROSS JOIN LATERAL jsonb_array_elements(s.answers) WITH ORDINALITY picked(answer,ordinality)
JOIN draft_run_decision_observations o
  ON o.session_id=s.id AND o.round=picked.ordinality::int AND o.outcome='pick'
  AND o.puzzle_id=picked.answer->'puzzle'->>'puzzle_id'
WHERE s.player_id=$1::uuid AND s.id=$2::uuid AND picked.ordinality=$3::int
  AND picked.answer->'puzzle'->>'puzzle_id'=$4
  AND NOT s.measurement_qa AND jsonb_array_length(s.puzzle_ids)=8
  AND s.selection_version IN ('eight-pick-v3','eight-pick-v4')
LIMIT 1`;
export async function loadDraftRunInsightDecision(query,owner,params={}) {
  const id=String(params.session_id||''),round=Number(params.round),puzzle=String(params.puzzle_id||'');
  if(!UUID.test(id)||!Number.isInteger(round)||round<1||round>8||
    !/^[a-zA-Z0-9._:-]{1,160}$/.test(puzzle))
    throw Object.assign(new Error('Invalid saved decision.'),{status:400});
  const found=await query(INSIGHTS_DECISION_SQL,[owner,id,round,puzzle]);
  const row=found.rows?.[0];
  if(!row)throw Object.assign(new Error('Saved decision unavailable.'),{status:404});
  const answer=typeof row.answer==='string'?JSON.parse(row.answer):row.answer;
  const detail=publicLockedDecision(answer,{
    answered_at:new Date(row.answered_at).toISOString(),scoring_version:row.scoring_version,
    corpus_version:row.corpus_version,
  });
  if(!detail||answer.puzzle.puzzle_id!==puzzle)
    throw Object.assign(new Error('Saved decision unavailable.'),{status:404});
  return detail;
}
