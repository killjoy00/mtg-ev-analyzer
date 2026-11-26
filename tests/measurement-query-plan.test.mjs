import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePlan,captureCorePlan,isCoreAggregate} from './support/measurement-query-plan.mjs';

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
