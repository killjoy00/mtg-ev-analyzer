import {DAILY_SELECTION_VERSION,dailySetPlan,balancedSetPlan,liveRegularSets} from '../daily-selection.mjs';
import {seededRandom} from '../gameplay.mjs';
import {runPickWindows,eligiblePickForRound,selectDraftRunReroll,draftRunDifficulty} from '../draft-run.mjs';
import {DRAFT_RUN_SELECTION_VERSION,PREVIOUS_SELECTION_VERSION,SELECTABLE_ONLY_SETS,chooseRunSet,runDifficultyBands,maxRunPick,isEightPickVersion,earlyRoundsForSelection,dailyRequiredSets,releasedRunSets,requiredSetRounds} from '../draft-run-policy.mjs';
import {gameDateKey} from '../game-date.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION,LEGACY_DIFFICULTY_VERSION,MAX_REROLL_RATING_DELTA} from '../draft-run-difficulty.mjs';

const columns = `p.puzzle_id,p.set_id,p.source_draft_hash,p.pack_number,p.pick_number,p.candidate_count,
  p.consensus_top_gap,p.support_entropy,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio,r.band`;
const from = `FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r
  ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'`;
const base = `p.corpus_version=$1 AND p.interesting AND p.pack_number=1`;
export function decodePuzzleMetadata(p) {
  return {...p, rating:Number(p.rating), top_two_ratio:Number(p.top_two_ratio),
    target_support_ratio:p.target_support_ratio==null?null:Number(p.target_support_ratio),
    pick_number:Number(p.pick_number),candidate_count:Number(p.candidate_count),
    consensus_top_gap:Number(p.consensus_top_gap),support_entropy:Number(p.support_entropy)};
}

export async function loadPuzzleMetadata(query,version,ids) {
  const result=await query(`SELECT ${columns} ${from} WHERE ${base} AND p.puzzle_id=ANY($2::text[])`,[version,toPgArray(ids)]);
  const byId=new Map(result.rows.map(p=>[p.puzzle_id,decodePuzzleMetadata(p)]));
  return ids.map(id=>byId.get(id));
}

// Neon SQL parameters are text, so encode arrays rather than relying on the
// driver's implicit conversion of JavaScript arrays.
export const toPgArray = values => `{${values.map(v=>`"${String(v).replaceAll('\\','\\\\').replaceAll('"','\\"')}"`).join(',')}}`;

function environmentFilter(environment,params,previous=false) {
  params.push(environment==='powered-cube');
  let sql=`(p.set_id='powered-cube')=$${params.length}::boolean`;
  if(!previous) {
    params.push(maxRunPick(environment));sql+=` AND p.pick_number<=$${params.length}::int`;
    if(environment!=='powered-cube') {params.push(toPgArray([...SELECTABLE_ONLY_SETS]));sql+=` AND p.set_id<>ALL($${params.length}::text[])`;}
  }
  return sql;
}

export async function loadLiveSetMetadata(query,version) {
  const result=await query(`SELECT p.set_id,p.release_date::text,p.status,p.regular_run,p.set_name
    FROM draft_run_environment_policy p JOIN corpus_set_versions v ON v.set_id=p.set_id
    WHERE v.corpus_version=$1 AND p.status='Live' ORDER BY p.set_id`,[version]);
  return result.rows.map(p=>({...p,regular_run:p.regular_run===true||p.regular_run==='t'}));
}

// Return compact group counts once, then one source trajectory per round. Every
// eligible puzzle participates: there is no random prefix or candidate cap.
// This consumes the same PRNG draws and sorted candidate order as selectDraftRun.
export async function selectDatabaseRun(query,version,seed,environment='mixed',{daily=false,day=gameDateKey(),selectionVersion=DRAFT_RUN_SELECTION_VERSION,setIds=[]}={}) {
  const random=seededRandom(seed),bands=runDifficultyBands(random,selectionVersion),selected=[],sources=[],sets=new Set();
  const windows=runPickWindows(environment,selectionVersion),released=new Set(releasedRunSets(day));
  const metadata=selectionVersion===DAILY_SELECTION_VERSION?await loadLiveSetMetadata(query,version):null;
  const live=metadata?new Set(metadata.filter(s=>environment==='powered-cube'?s.set_id==='powered-cube':s.regular_run&&s.release_date&&s.release_date<=day).map(s=>s.set_id)):null;
  const groupParams=[version];
  const groupWhere=`${base} AND ${environmentFilter(environment,groupParams)}`;
  const groups=(await query(`SELECT p.set_id,p.pick_number,r.band,count(*)::int n ${from} WHERE ${groupWhere} GROUP BY p.set_id,p.pick_number,r.band`,groupParams)).rows.map(g=>({...g,pick_number:Number(g.pick_number),n:Number(g.n)})).filter(g=>(!live||live.has(g.set_id))&&(!daily||selectionVersion===DAILY_SELECTION_VERSION||!isEightPickVersion(selectionVersion)||environment==='powered-cube'||released.has(g.set_id)));
  if(setIds.length){const eligible=new Set(liveRegularSets(metadata||[],day).map(s=>s.set_id));if(setIds.some(s=>!eligible.has(s)))throw Object.assign(Error('Choose Live eligible sets.'),{status:400});}
  const required=setIds.length?balancedSetPlan(setIds,random):daily&&environment==='mixed'&&selectionVersion===DAILY_SELECTION_VERSION?dailySetPlan(metadata,day,random):daily&&environment==='mixed'&&isEightPickVersion(selectionVersion)?dailyRequiredSets(day):[];
  const forced=requiredSetRounds(groups,bands,windows,random,required);
  const key=p=>`${p.set_id}:${p.pick_number}:${p.band}`;
  const remaining=new Map(groups.map(g=>[key(g),g]));
  for(let round=0;round<windows.length;round++) {
    const window=windows[round];
    const params=[version,window[0],window[1],toPgArray(sources)];
    const where=`${base} AND p.pick_number BETWEEN $2::int AND $3::int AND p.source_draft_hash<>ALL($4::text[]) AND ${environmentFilter(environment,params)}`;
    const availableFor=band=>{
      const counts=new Map();
      for(const g of groups)if(g.band===band&&g.pick_number>=window[0]&&g.pick_number<=window[1]&&g.n>0&&(forced.has(round)?g.set_id===forced.get(round):!required.includes(g.set_id)))counts.set(g.set_id,(counts.get(g.set_id)||0)+g.n);
      return [...counts].map(([set_id,n])=>({set_id,n}));
    };
    let band=bands[round],available=availableFor(band);
    if(!available.length&&band==='easy'){band='medium';available=availableFor(band);}
    const fresh=available.filter(g=>!sets.has(g.set_id));
    if(fresh.length&&!forced.has(round))available=fresh;
    else {const different=available.filter(g=>g.set_id!==selected.at(-1)?.set_id);if(different.length)available=different;}
    const setId=chooseRunSet(available.map(g=>g.set_id).sort(),random,daily,selectionVersion,day);
    const count=Number(available.find(g=>g.set_id===setId)?.n||0);
    if(!count)throw Object.assign(new Error('Not enough verified puzzles for a balanced run.'),{status:503});
    params.push(setId,band,Math.floor(random()*count));
    const result=await query(`WITH chosen AS (
      SELECT p.puzzle_id,p.source_draft_hash ${from} WHERE ${where} AND p.set_id=$${params.length-2} AND r.band=$${params.length-1}
      ORDER BY p.puzzle_id COLLATE "C" LIMIT 1 OFFSET $${params.length}::int
    ) SELECT ${columns},chosen.puzzle_id selected_id ${from} JOIN chosen ON chosen.source_draft_hash=p.source_draft_hash WHERE ${base}`,params);
    const trajectory=result.rows.map(decodePuzzleMetadata),p=trajectory.find(p=>p.puzzle_id===p.selected_id);
    if(!p)throw Object.assign(new Error('The corpus changed while starting this run. Please retry.'),{status:503});
    selected.push(p);sources.push(p.source_draft_hash);sets.add(p.set_id);
    // Once a source is used, every one of its decisions disappears from future
    // counts. This preserves exact source exclusion without per-round recounts.
    for(const sibling of trajectory){const group=remaining.get(key(sibling));if(group)group.n--;}

  }
  return selected;
}

export async function selectDatabaseReroll(query,version,source,options) {
  const {environment='mixed',selectionVersion=DRAFT_RUN_SELECTION_VERSION,difficultyVersion=DRAFT_RUN_DIFFICULTY_VERSION,round,type,anchor}=options;
  if(!['set','pack'].includes(type)||environment==='powered-cube'&&type==='set')throw Error('Invalid reroll.');
  if(![LEGACY_DIFFICULTY_VERSION,DRAFT_RUN_DIFFICULTY_VERSION].includes(difficultyVersion))throw Error('Unsupported difficulty version.');
  const previous=selectionVersion===PREVIOUS_SELECTION_VERSION,a=draftRunDifficulty(source),origin=anchor||a;
  const picks=Array.from({length:12},(_,i)=>i+1).filter(p=>eligiblePickForRound(round,p,environment,selectionVersion)&&Math.abs(p-source.pick_number)<=1);
  if(!picks.length)return null;
  const params=[version,picks[0],picks.at(-1),toPgArray([...new Set([...(options.excludedSources||[]),source.source_draft_hash])])];
  let where=`${base} AND p.pick_number BETWEEN $2::int AND $3::int AND p.source_draft_hash<>ALL($4::text[]) AND ${environmentFilter(environment,params,previous)}`;
  if(options.setIds?.length){params.push(toPgArray(options.setIds));where+=` AND p.set_id=ANY($${params.length}::text[])`;}
  if(selectionVersion===DAILY_SELECTION_VERSION)where+=" AND EXISTS(SELECT 1 FROM draft_run_environment_policy e WHERE e.set_id=p.set_id AND e.status='Live' AND (e.regular_run OR e.set_id='powered-cube'))";
  params.push(source.set_id);where+=` AND p.set_id${type==='set'?'<>':'='}$${params.length}`;
  if(!previous&&round>=earlyRoundsForSelection(selectionVersion))where+=" AND r.band<>'easy'";
  if(options.daily&&isEightPickVersion(selectionVersion)&&environment==='mixed') {
    params.push(toPgArray(releasedRunSets(options.day||gameDateKey())));where+=` AND p.set_id=ANY($${params.length}::text[])`;
  }
  if(difficultyVersion!==LEGACY_DIFFICULTY_VERSION) {
    if(a.band!==origin.band)return null;
    params.push(a.band,Math.max(a.rating,origin.rating)-MAX_REROLL_RATING_DELTA,Math.min(a.rating,origin.rating)+MAX_REROLL_RATING_DELTA);
    where+=` AND r.band=$${params.length-2} AND r.rating BETWEEN $${params.length-1}::int AND $${params.length}::int`;
  }
  params.push(a.pickNumber,a.candidateCount,a.topGap,a.entropy,a.priorPoolSize);
  const n=params.length;
  // Use float8 arithmetic in the same order as draftRunRerollDistance. The
  // final shared selector revalidates the bounded result and owns RNG policy.
  const distance=`(abs(p.pick_number-$${n-4}::float8)/3)*0.35
    +(abs(p.candidate_count-$${n-3}::float8)/greatest(1,p.candidate_count,$${n-3}::float8))*0.15
    +abs(p.consensus_top_gap::text::float8-$${n-2}::float8)*0.25
    +abs(p.support_entropy::text::float8-$${n-1}::float8)*0.15
    +(abs((p.pick_number-1)-$${n}::float8)/greatest(1,p.pick_number-1,$${n}::float8))*0.10`;
  const result=await query(`SELECT * FROM (SELECT ${columns},${distance} distance ${from} WHERE ${where}) candidates
    WHERE distance<=0.16 ORDER BY distance,puzzle_id COLLATE "C" LIMIT 20`,params);
  return selectDraftRunReroll(result.rows.map(decodePuzzleMetadata),source,options);
}
