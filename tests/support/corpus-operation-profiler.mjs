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
  let lastMark=started,finished=false;
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
    try {return await original.call(this,input,init);}
    finally {record(kind,clock()-begin);}
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
