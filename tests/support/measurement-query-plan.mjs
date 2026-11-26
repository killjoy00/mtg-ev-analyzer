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
