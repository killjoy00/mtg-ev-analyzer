// Only plan structure is public. Never log EXPLAIN text, estimates, values,
// conditions, SQL, relation aliases, query parameters, or actual data.
const KINDS=new Set([
  'Aggregate','Append','BitmapAnd','BitmapOr','Bitmap Heap Scan','Bitmap Index Scan',
  'CTE Scan','Custom Scan','Foreign Scan','Function Scan','Gather','Gather Merge',
  'Group','Hash','Hash Join','Incremental Sort','Index Scan','Index Only Scan',
  'Limit','Materialize','Memoize','Merge Append','Merge Join','Nested Loop',
  'ProjectSet','Recursive Union','Result','Seq Scan','SetOp','Sort','Subquery Scan',
  'Tid Scan','Tid Range Scan','Unique','Values Scan','WindowAgg','WorkTable Scan'
]);
export function summarizePlan(raw) {
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const root=Array.isArray(parsed)?parsed[0]?.Plan:parsed?.Plan;
  if(!root||typeof root!=='object')throw Error('Missing query plan');
  const types={};
  let subplans=0,maxDepth=0;
  function walk(node,depth) {
    if(!node||typeof node!=='object')return;
    const kind=KINDS.has(node['Node Type'])?node['Node Type']:'Other';
    types[kind]=(types[kind]||0)+1;
    if(node['Parent Relationship']==='SubPlan'||node['Parent Relationship']==='InitPlan')subplans++;
    maxDepth=Math.max(maxDepth,depth);
    for(const child of Array.isArray(node.Plans)?node.Plans:[])walk(child,depth+1);
  }
  walk(root,1);
  return {types,subplans,max_depth:maxDepth};
}
export function isCoreAggregate(sql) {
  return typeof sql==='string'&&sql.startsWith('WITH scoped AS MATERIALIZED (SELECT * FROM draft_run_source_measurements')&&sql.includes('primary_data AS MATERIALIZED')&&sql.includes('FROM coverage CROSS JOIN summary');
}
// The caller has already verified the CI fixture branch and admin session.
// EXPLAIN without ANALYZE plans, but does not execute, the real query.
export async function captureCorePlan(query,invoke) {
  let plan;
  await invoke(async(sql,params)=>{
    if(!isCoreAggregate(sql))return query(sql,params);
    if(plan)throw Error('Duplicate measurement core query');
    const response=await query('EXPLAIN (FORMAT JSON) '+sql,params);
    plan=summarizePlan(response.rows[0]?.['QUERY PLAN']);
    // Do not execute the expensive aggregate twice. The original full API
    // calls and all assertions run independently, unchanged, afterward.
    return {rows:[],rowCount:0};
  });
  if(!plan)throw Error('Measurement core query was not captured');
  return plan;
}

/**
 * Experimental report-only rewrite. Keep the old view as the reference and
 * retain all history, including observations/answers outside the report.
 * No schema, runtime, or persistent cache changes are made by this experiment.
 */
export function buildCandidateCoreAggregate(sql) {
  if(!isCoreAggregate(sql))throw Error('Unexpected measurement core statement');
  const prefix='WITH scoped AS MATERIALIZED (SELECT * FROM draft_run_source_measurements';
  const boundary=/\),\s*primary_data AS MATERIALIZED/.exec(sql);
  if(!boundary)throw Error('Missing measurement scope boundary');
  const filters=sql.slice(prefix.length,boundary.index);
  if(!filters.startsWith(' WHERE '))throw Error('Unexpected measurement filters');
  return `WITH scoped_population AS MATERIALIZED (
    SELECT * FROM (
      SELECT o.*,s.player_id,s.environment,s.day,s.corpus_version,s.scoring_version,s.difficulty_version,s.selection_version,
        s.created_at session_created_at,
        CASE WHEN s.day IS NOT NULL THEN 'daily' WHEN s.challenge_id IS NOT NULL THEN 'challenge' ELSE 'practice' END run_type,
        jsonb_array_length(s.answers)=jsonb_array_length(s.puzzle_ids) run_complete,
        s.measurement_qa OR p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)' is_qa,
        v.set_id,v.pick_number,r.rating,r.band,r.target_support_ratio<0.2 model_disagreement,
        o.outcome IS NULL AND jsonb_array_length(s.answers)<jsonb_array_length(s.puzzle_ids)
          AND greatest(o.last_seen_at,s.updated_at)<now()-interval '24 hours' likely_abandoned,
        coalesce(v.payload->>'source_event_type','PremierDraft') source_event_type
      FROM draft_run_decision_observations o
      JOIN draft_run_sessions s ON s.id=o.session_id
      JOIN players p ON p.id=s.player_id
      JOIN draft_run_verified_puzzles v ON v.puzzle_id=o.puzzle_id
      LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=o.puzzle_id AND r.difficulty_version=s.difficulty_version
    ) population${filters}
  ), history_keys AS MATERIALIZED (
    SELECT player_id,puzzle_id,max(session_created_at) latest_session_created_at
    FROM scoped_population
    WHERE (observed OR outcome='pick') AND NOT is_qa
    GROUP BY player_id,puzzle_id
  ), earliest_observation AS MATERIALIZED (
    SELECT DISTINCT ON (k.player_id,k.puzzle_id) k.player_id,k.puzzle_id,
      prior.first_seen_at,prior.session_id,prior.revision
    FROM history_keys k
    JOIN draft_run_sessions ps ON ps.player_id=k.player_id
    JOIN draft_run_decision_observations prior ON prior.session_id=ps.id AND prior.puzzle_id=k.puzzle_id
    WHERE prior.observed
    ORDER BY k.player_id,k.puzzle_id,prior.first_seen_at,prior.session_id,prior.revision
  ), earliest_answer AS MATERIALIZED (
    SELECT k.player_id,k.puzzle_id,min(old.created_at) created_at
    FROM history_keys k
    JOIN draft_run_sessions old ON old.player_id=k.player_id
      AND old.created_at<k.latest_session_created_at
      AND old.answers @> jsonb_build_array(jsonb_build_object('puzzle',jsonb_build_object('puzzle_id',k.puzzle_id)))
    GROUP BY k.player_id,k.puzzle_id
  ), scoped AS MATERIALIZED (
    SELECT d.*,
      NOT coalesce((p.first_seen_at,p.session_id,p.revision)<(d.first_seen_at,d.session_id,d.revision),false)
      AND NOT coalesce(a.created_at<d.session_created_at,false) first_encounter
    FROM scoped_population d
    LEFT JOIN earliest_observation p USING(player_id,puzzle_id)
    LEFT JOIN earliest_answer a USING(player_id,puzzle_id)
  `+sql.slice(boundary.index);
}

// Report rows are private. Compare them inside the database in one statement,
// at the same MVCC snapshot and transaction timestamp (including now()).
export function sameSnapshotComparison(baseline,candidate) {
  return `WITH baseline AS MATERIALIZED (${baseline}), candidate AS MATERIALIZED (${candidate})
    SELECT (SELECT count(*) FROM baseline)=1 AND (SELECT count(*) FROM candidate)=1
      AND (SELECT to_jsonb(b) FROM baseline b) IS NOT DISTINCT FROM
          (SELECT to_jsonb(c) FROM candidate c) AS equivalent`;
}
function actualPlanSummary(raw) {
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const document=Array.isArray(parsed)?parsed[0]:parsed;
  const summary=summarizePlan(raw), slow=[];
  function walk(node) {
    const total=Number(node['Actual Total Time'])*Number(node['Actual Loops']);
    if(Number.isFinite(total))slow.push({kind:KINDS.has(node['Node Type'])?node['Node Type']:'Other',inclusive_ms:Math.round(total)});
    for(const child of Array.isArray(node.Plans)?node.Plans:[])walk(child);
  }
  walk(document.Plan);
  return {...summary,execution_ms:Math.round(Number(document['Execution Time'])),slow_nodes:slow.sort((a,b)=>b.inclusive_ms-a.inclusive_ms).slice(0,8)};
}

// Only run on the explicitly named disposable benchmark PR. The expensive
// paired measurements must never become part of routine CI on main.
export async function benchmarkCoreCandidate(query,invoke) {
  let captured;
  await invoke(async(sql,params)=>{
    if(!isCoreAggregate(sql))return query(sql,params);
    if(captured)throw Error('Duplicate measurement core query');
    captured={sql,params};
    return {rows:[],rowCount:0};
  });
  if(!captured)throw Error('Measurement core query was not captured');
  const {sql:baseline,params}=captured,candidate=buildCandidateCoreAggregate(baseline);
  const result=await query(sameSnapshotComparison(baseline,candidate),params);
  if(![true,'t'].includes(result.rows[0]?.equivalent))throw Error('Measurement result equivalence failed');
  console.log(JSON.stringify({event:'isolated_measurement_candidate_equivalence',equivalent:true}));
  for(const [variant,statement] of [['baseline',baseline],['candidate',candidate]]) {
    const response=await query('EXPLAIN (ANALYZE, FORMAT JSON) '+statement,params);
    console.log(JSON.stringify({event:'isolated_measurement_actual_plan',variant,...actualPlanSummary(response.rows[0]?.['QUERY PLAN'])}));
  }
  // Alternate ordering; identical filters, clone, compute and query transport.
  // Each pair runs without fixture mutations. Output no result data or counts.
  for(let sample=1;sample<=3;sample++) {
    const variants=sample===2?[['candidate',candidate],['baseline',baseline]]:[['baseline',baseline],['candidate',candidate]];
    const elapsed={};
    for(const [variant,statement] of variants) {
      const started=performance.now();
      const response=await query(statement,params);
      elapsed[variant]=Math.round(performance.now()-started);
      if(response.rows.length!==1)throw Error('Unexpected measurement aggregate shape');
    }
    console.log(JSON.stringify({event:'isolated_measurement_candidate_timing',sample,baseline_ms:elapsed.baseline,candidate_ms:elapsed.candidate}));
  }
}
