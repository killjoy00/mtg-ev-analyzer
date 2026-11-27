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
  return typeof sql==='string'&&(sql.startsWith('WITH scoped_population AS MATERIALIZED (')||sql.startsWith('WITH scoped AS MATERIALIZED (SELECT * FROM draft_run_source_measurements'))&&sql.includes('primary_data AS MATERIALIZED')&&sql.includes('FROM coverage CROSS JOIN summary');
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

// Reconstruct the exact old view-based scope from the real optimized
// report. Keep the identical filters, aggregate suffix and MVCC snapshot.
// Only the test helper uses the legacy query, not the deployed request.
export function referenceCoreAggregate(sql) {
  if(!isCoreAggregate(sql)||!sql.startsWith('WITH scoped_population AS MATERIALIZED ('))throw Error('Unexpected optimized measurement aggregate');
  const populationEnd=sql.indexOf(') population WHERE ');
  const historyStart=sql.indexOf('  ), history_keys AS MATERIALIZED (',populationEnd);
  const primaryStart=/\),\s*primary_data AS MATERIALIZED/.exec(sql);
  if(populationEnd<0||historyStart<0||!primaryStart)throw Error('Missing optimized scope boundaries');
  const filters=sql.slice(populationEnd+') population'.length,historyStart).trimEnd();
  return 'WITH scoped AS MATERIALIZED (SELECT * FROM draft_run_source_measurements'+filters+sql.slice(primaryStart.index);
}
export function sameSnapshotComparison(baseline,candidate) {
  return `WITH baseline AS MATERIALIZED (${baseline}), candidate AS MATERIALIZED (${candidate})
    SELECT (SELECT count(*) FROM baseline)=1 AND (SELECT count(*) FROM candidate)=1
      AND (SELECT to_jsonb(b) FROM baseline b) IS NOT DISTINCT FROM
          (SELECT to_jsonb(c) FROM candidate c) AS equivalent`;
}
export async function verifyAnswerExpansion(query) {
  const result=await query(`WITH shapes(answers) AS (VALUES
    ('[]'::jsonb),('[{"puzzle":{"puzzle_id":"x","other":1}}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":["x"]}}]'::jsonb),
    ('[{"puzzle":[{"puzzle_id":"x"}]}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":null}}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":1}}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":"1"}}, {"puzzle":{"puzzle_id":"x"}}]'::jsonb),
    ('[{"puzzle":null},null,[],42,"x",{"puzzle_id":"x"}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":""}}]'::jsonb),
    ('[{"puzzle":{"puzzle_id":"X"}}]'::jsonb)
  ), keys(puzzle_id) AS (VALUES ('x'),('1'),(''),('X'),('absent'))
  SELECT bool_and(
    (answers @> jsonb_build_array(jsonb_build_object('puzzle',jsonb_build_object('puzzle_id',puzzle_id))))
      = EXISTS(SELECT 1 FROM jsonb_array_elements(answers) e(value)
        WHERE jsonb_typeof(e.value#>'{puzzle,puzzle_id}')='string'
        AND e.value#>>'{puzzle,puzzle_id}'=puzzle_id)
  ) equivalent FROM shapes CROSS JOIN keys`,[]);
  if(![true,'t'].includes(result.rows[0]?.equivalent))throw Error('Historical answer expansion shape equivalence failed');
  console.log(JSON.stringify({event:'isolated_measurement_answer_shape_equivalence',equivalent:true}));
}
