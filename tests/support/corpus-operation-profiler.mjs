// Test-only timing of the existing Neon SQL requests, including the actual
// router's internally-issued lifecycle queries. Never log SQL, parameters,
// result bodies, IDs, connection strings, URLs, or exception text.
export function corpusQueryKind(sql) {
  if(typeof sql!=='string')return 'other';
  const s=sql.trim();
  if(/^SELECT pack1_build_serving_snapshot\(/i.test(s))return 'snapshot_build_or_reuse';
  if(/^SELECT pack1_serving_snapshot\(/i.test(s))return 'snapshot_read';
  if(/^WITH expected AS MATERIALIZED \(/i.test(s)&&s.includes('draft_run_serving_inventory')&&s.includes('EXCEPT'))return 'inventory_exact_verification';
  if(/pack1_serving_snapshot_matches_current\(/i.test(s))return 'snapshot_carry_check';
  if(/pack1_claim_readiness\(/i.test(s))return 'readiness_claim';
  if(/pack1_readiness_verifying\(/i.test(s))return 'readiness_verifying';
  if(/pack1_complete_readiness\(/i.test(s))return 'readiness_complete';
  if(/pack1_fail_readiness\(/i.test(s))return 'readiness_fail';
  if(/pack1_retry_readiness\(/i.test(s))return 'readiness_retry';
  if(/pack1_register_readiness_key\(/i.test(s))return 'readiness_register';
  if(/^SELECT rv\.revision::text current_revision/i.test(s))return 'readiness_status';
  if(/^WITH identity_allowed AS MATERIALIZED/i.test(s))return 'lifecycle_mutation';
  if(/^SELECT p\.puzzle_id FROM draft_run_verified_puzzles p/i.test(s)&&s.includes('ORDER BY p.puzzle_id LIMIT 1'))return 'fixture_template_lookup';
  if(/INSERT INTO draft_run_verified_puzzles/i.test(s))return 'fixture_puzzle_insert';
  if(/^(UPDATE|DELETE FROM) draft_run_verified_puzzles/i.test(s))return 'fixture_puzzle_change';
  if(/^SELECT revision::text/i.test(s)&&s.includes('draft_run_serving_revision'))return 'revision_read';
  if(/^ANALYZE\b/i.test(s))return 'statistics_refresh';
  if(s.includes('draft_run_serving_inventory'))return 'inventory_other';
  if(s.includes('draft_run_puzzle_ratings')||s.includes('draft_run_verified_puzzles'))return 'puzzle_rating_other';
  return 'other';
}
// Both inputs have a unique, non-null puzzle_id (the puzzle, versioned
// rating and snapshot inventory primary keys). A metadata mismatch counts
// once on each side, exactly as bidirectional EXCEPT does.
export function buildInventoryJoinCandidate(sql) {
  const boundary=sql.indexOf(') SELECT (SELECT count(*)::int FROM expected) expected');
  if(boundary<0||!sql.includes('SELECT * FROM expected EXCEPT SELECT * FROM actual')||
    !sql.includes('SELECT * FROM actual EXCEPT SELECT * FROM expected'))throw Error('Unexpected exact inventory statement');
  const scope=sql.slice(0,boundary+1).replace('expected AS MATERIALIZED','expected AS').replace('actual AS MATERIALIZED','actual AS');
  return scope+` SELECT count(e.puzzle_id)::int expected,count(a.puzzle_id)::int actual,
    count(*) FILTER(WHERE e.puzzle_id IS NOT NULL AND (a.puzzle_id IS NULL OR
      (e.set_id,e.pick_number,e.band,e.source_draft_hash) IS DISTINCT FROM
      (a.set_id,a.pick_number,a.band,a.source_draft_hash)))::int missing,
    count(*) FILTER(WHERE a.puzzle_id IS NOT NULL AND (e.puzzle_id IS NULL OR
      (e.set_id,e.pick_number,e.band,e.source_draft_hash) IS DISTINCT FROM
      (a.set_id,a.pick_number,a.band,a.source_draft_hash)))::int extra
    FROM expected e FULL OUTER JOIN actual a ON a.puzzle_id=e.puzzle_id`;
}

function comparison(baseline,candidate) {
  return `WITH b AS MATERIALIZED (${baseline}),c AS MATERIALIZED (${candidate})
    SELECT (SELECT to_jsonb(b) FROM b) IS NOT DISTINCT FROM (SELECT to_jsonb(c) FROM c) equivalent`;
}
function planTiming(raw) {
  const doc=typeof raw==='string'?JSON.parse(raw):raw;
  const root=Array.isArray(doc)?doc[0]:doc;
  if(!root?.Plan)throw Error('Missing inventory execution plan');
  return {execution_ms:Math.round(Number(root['Execution Time'])),
    shared_read_blocks:Number(root.Plan['Shared Read Blocks']||0),
    temp_read_blocks:Number(root.Plan['Temp Read Blocks']||0),
    temp_written_blocks:Number(root.Plan['Temp Written Blocks']||0)};
}
async function benchmarkInventory(original,input,init,emit) {
  const {query:baseline,params}=JSON.parse(init.body);
  const candidate=buildInventoryJoinCandidate(baseline);
  async function execute(sql,args=params) {
    // Fresh deadline for each diagnostic; never extend the normal request.
    const begin=performance.now();
    const response=await original(input,{...init,body:JSON.stringify({query:sql,params:args}),signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error('Isolated inventory diagnostic SQL failed');
    const result=await response.json();
    return {result,ms:Math.round(performance.now()-begin)};
  }
  // Synthetic independent coverage for all four counters, including each
  // metadata field and differing keys; no changes to the actual inventory.
  const fixture=`WITH expected AS MATERIALIZED (
    SELECT * FROM (VALUES ('a','s',1,'easy','h'),('b','s',2,'hard','i'),('c','s',3,'easy','j'),
      ('d','s',4,'easy','k'),('e','s',5,'easy','l'),('f','s',6,'easy','m')) v(puzzle_id,set_id,pick_number,band,source_draft_hash)
  ), actual AS MATERIALIZED (
    SELECT * FROM (VALUES ('a','s',1,'easy','h'),('c','t',3,'easy','j'),('d','s',9,'easy','k'),
      ('e','s',5,'hard','l'),('f','s',6,'easy','z'),('g','s',7,'easy','n')) v(puzzle_id,set_id,pick_number,band,source_draft_hash)
  ) SELECT (SELECT count(*)::int FROM expected) expected,(SELECT count(*)::int FROM actual) actual,
  (SELECT count(*)::int FROM (SELECT * FROM expected EXCEPT SELECT * FROM actual) q) missing,
  (SELECT count(*)::int FROM (SELECT * FROM actual EXCEPT SELECT * FROM expected) q) extra`;
  const synthetic=await execute(comparison(fixture,buildInventoryJoinCandidate(fixture)),[]);
  if(![true,'t'].includes(synthetic.result.rows[0]?.equivalent))throw Error('Synthetic inventory parity failed');
  const matched=await execute(comparison(baseline,candidate));
  if(![true,'t'].includes(matched.result.rows[0]?.equivalent))throw Error('Full inventory parity failed');
  emit(JSON.stringify({event:'isolated_inventory_candidate_equivalence',synthetic:true,equivalent:true}));
  for(const [variant,sql] of [['baseline',baseline],['candidate',candidate]]) {
    const {result}=await execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql);
    emit(JSON.stringify({event:'isolated_inventory_actual_plan',variant,...planTiming(result.rows[0]?.['QUERY PLAN'])}));
  }
  for(let sample=1;sample<=3;sample++) {
    const timings={};
    const variants=sample===2?[['candidate',candidate],['baseline',baseline]]:[['baseline',baseline],['candidate',candidate]];
    for(const [variant,sql] of variants)timings[variant]=(await execute(sql)).ms;
    emit(JSON.stringify({event:'isolated_inventory_candidate_timing',sample,baseline_ms:timings.baseline,candidate_ms:timings.candidate}));
  }
  // Attribute read-only suboperations of the real installed builder.
  // Read its definition only on this disposable branch; do not log it or
  // run the INSERT, DELETE, lock, revision, or publication statements.
  const definition=(await execute("SELECT pg_get_functiondef('public.pack1_build_serving_snapshot(text,text,text)'::regprocedure) definition",[])).result.rows[0]?.definition;
  const start=definition?.indexOf('WITH active_parent_sets AS MATERIALIZED (')??-1;
  const insert=definition?.indexOf('INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash)',start)??-1;
  const end=definition?.indexOf(';',insert)??-1;
  if(start<0||insert<0||end<0)throw Error('Unrecognized installed builder; no profiling of writes');
  const select=definition.slice(start,insert)+definition.slice(insert,end).replace(/^INSERT INTO draft_run_serving_inventory\(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash\)\s*SELECT snapshot\.id,/, 'SELECT ');
  const eligibility=select.replace(/\bp_parent_version\b/g,'$1').replace(/\bp_difficulty\b/g,'$2');
  if(!eligibility.includes('SELECT p.puzzle_id,')||/\b(INSERT|DELETE|UPDATE|TRUNCATE)\b/i.test(eligibility))throw Error('Unsafe builder diagnostic statement');
  const eligibilityPlan=await execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+eligibility,[params[0],params[2]]);
  emit(JSON.stringify({event:'isolated_builder_read_plan',stage:'eligibility',...planTiming(eligibilityPlan.result.rows[0]?.['QUERY PLAN'])}));
  const groups=await execute(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.set_id,g.pick_number,g.band),'[]')
    FROM (SELECT set_id,pick_number,band,count(*)::int n,count(DISTINCT source_draft_hash)::int sources
    FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint GROUP BY set_id,pick_number,band) g`,[params[1]]);
  emit(JSON.stringify({event:'isolated_builder_read_plan',stage:'groups',...planTiming(groups.result.rows[0]?.['QUERY PLAN'])}));
}
export function corpusOperationProfiler({suite,connection,env=process.env,clock=()=>performance.now(),emit=console.log}={}) {
  if(!['corpus-admin','corpus-readiness'].includes(suite))throw Error('Unexpected corpus profiler suite');
  const enabled=env.CI==='true'&&env.GITHUB_HEAD_REF==='perf/corpus-readiness-profile'
    &&env.PACK1_CI_BRANCH_ID?.startsWith('br-')
    &&!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(env.PACK1_CI_BRANCH_ID);
  if(!enabled)return {finish(){},mark(){}};
  const db=new URL(connection);
  if(!['postgres:','postgresql:'].includes(db.protocol)||!db.hostname.endsWith('.neon.tech'))throw Error('Isolated Neon connection required');
  const endpoint='https://api.'+db.hostname.split('.').slice(1).join('.')+'/sql';
  const original=globalThis.fetch;
  const stats=new Map(),started=clock();
  let lastMark=started,finished=false,benchmarked=false;
  function record(kind,ms) {
    const entry=stats.get(kind)||{calls:0,total_ms:0,max_ms:0};
    entry.calls++;entry.total_ms+=ms;entry.max_ms=Math.max(entry.max_ms,ms);
    stats.set(kind,entry);
    if(ms>=250)emit(JSON.stringify({event:'isolated_corpus_sql_timing',suite,kind,elapsed_ms:Math.round(ms)}));
  }
  const wrapped=async function(input,init) {
    let kind;
    // Observe only requests for this exact disposable connection. Do not
    // consume or clone response bodies, and do not change timeout/retries.
    if(typeof input==='string'&&input===endpoint&&init?.method==='POST'&&
       new Headers(init.headers).get('Neon-Connection-String')===connection&&typeof init.body==='string') {
      try {kind=corpusQueryKind(JSON.parse(init.body).query);} catch {kind='other';}
    }
    if(!kind)return original.call(this,input,init);
    const begin=clock();
    let response;
    try {response=await original.call(this,input,init);}
    finally {record(kind,clock()-begin);}
    // First real exact verification in the readiness suite only. The baseline
    // response and all existing assertions remain untouched. Diagnostic time
    // is separate from operation stats, but included in experiment wall time.
    if(suite==='corpus-readiness'&&kind==='inventory_exact_verification'&&!benchmarked&&response.ok) {
      benchmarked=true;
      const started=performance.now();
      try {await benchmarkInventory(original,input,init,emit);}
      catch {throw Error('Isolated inventory candidate diagnostic failed; do not promote');}
      finally {emit(JSON.stringify({event:'isolated_inventory_benchmark_overhead',elapsed_ms:Math.round(performance.now()-started)}));}
    }
    return response;
  };
  globalThis.fetch=wrapped;
  return {
    // Only ordinal boundaries: no arbitrary checkpoint text or identifiers.
    mark() {
      const now=clock();
      emit(JSON.stringify({event:'isolated_corpus_checkpoint_timing',suite,elapsed_ms:Math.round(now-lastMark)}));
      lastMark=now;
    },
    finish() {
      if(finished)return;
      finished=true;
      if(globalThis.fetch===wrapped)globalThis.fetch=original;
      const operations=Object.fromEntries([...stats].map(([kind,x])=>[kind,{calls:x.calls,total_ms:Math.round(x.total_ms),max_ms:Math.round(x.max_ms)}]));
      emit(JSON.stringify({event:'isolated_corpus_profile_summary',suite,wall_ms:Math.round(clock()-started),operations}));
    }
  };
}
