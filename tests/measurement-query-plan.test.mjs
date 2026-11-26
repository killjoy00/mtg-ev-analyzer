import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePlan,captureCorePlan,isCoreAggregate,buildCandidateCoreAggregate,sameSnapshotComparison} from './support/measurement-query-plan.mjs';

const sql='WITH scoped AS MATERIALIZED (SELECT * FROM draft_run_source_measurements WHERE first_seen_at >= $1), primary_data AS MATERIALIZED (SELECT * FROM scoped) SELECT * FROM coverage CROSS JOIN summary';
const input=[{Plan:{'Node Type':'Aggregate',Filter:'PRIVATE VALUE','Plan Rows':123,Plans:[{'Node Type':'Seq Scan','Relation Name':'private_relation','Parent Relationship':'SubPlan','Filter':'SECRET SQL'}, {'Node Type':'Arbitrary private text','Parent Relationship':'InitPlan'}]}}];
test('only known plan structure can be published',()=>{
  const result=summarizePlan(JSON.stringify(input));
  assert.deepEqual(result,{types:{Aggregate:1,'Seq Scan':1,Other:1},subplans:2,max_depth:2});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SECRET|private_relation|123|Arbitrary/);
});
test('profile plans the exact core aggregate and never executes it',async()=>{
  const calls=[];
  const q=async(s,p)=>{calls.push([s,p]);return {rows:[{'QUERY PLAN':input}]};};
  const result=await captureCorePlan(q,async wrapped=>{
    await wrapped('SELECT role FROM pack1_admins',[]);
    const response=await wrapped(sql,['2026-11-26']);
    assert.deepEqual(response,{rows:[],rowCount:0});
  });
  assert.equal(result.subplans,2);
  assert.deepEqual(calls,[['SELECT role FROM pack1_admins',[]],['EXPLAIN (FORMAT JSON) '+sql,['2026-11-26']]]);
  assert.equal(isCoreAggregate('SELECT 1'),false);
  await assert.rejects(captureCorePlan(q,async()=>{}),/not captured/);
});

test('candidate preserves scope and report aggregate while moving history after population',()=>{
  const candidate=buildCandidateCoreAggregate(sql);
  assert.match(candidate,/WITH scoped_population AS MATERIALIZED/);
  assert.match(candidate,/\) population WHERE first_seen_at >= \$1/);
  assert.match(candidate,/FROM scoped_population\s+WHERE \(observed OR outcome='pick'\) AND NOT is_qa/);
  assert.match(candidate,/GROUP BY player_id,puzzle_id/);
  assert.match(candidate,/ORDER BY k.player_id,k.puzzle_id,prior.first_seen_at,prior.session_id,prior.revision/);
  assert.match(candidate,/WHERE prior.observed/);
  assert.match(candidate,/old.created_at<k.latest_session_created_at/);
  assert.match(candidate,/old.answers @> jsonb_build_array/);
  assert.match(candidate,/NOT coalesce\(a.created_at<d.session_created_at,false\)/);
  assert.ok(candidate.endsWith('primary_data AS MATERIALIZED (SELECT * FROM scoped) SELECT * FROM coverage CROSS JOIN summary'));
  assert.doesNotMatch(candidate,/FROM draft_run_source_measurements/);
  assert.throws(()=>buildCandidateCoreAggregate('SELECT 1'),/Unexpected/);
  const comparison=sameSnapshotComparison(sql,candidate);
  assert.match(comparison,/WITH baseline AS MATERIALIZED/);
  assert.match(comparison,/candidate AS MATERIALIZED/);
  assert.match(comparison,/IS NOT DISTINCT FROM/);
  assert.match(comparison,/SELECT count\(\*\) FROM baseline\)=1/);
});
