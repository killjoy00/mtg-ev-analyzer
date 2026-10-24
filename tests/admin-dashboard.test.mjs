import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../worker/measurement-admin.mjs';
import {trendChange,trendsMarkup,healthMarkup} from '../admin/overview.mjs';
const authSql=sql=>sql.includes('FROM neon_auth.session s')?[{user_id:'11111111-1111-4111-8111-111111111111'}]:sql.includes('SELECT role FROM pack1_admins')?[{role:'owner'}]:null;
async function queryFixture(sql,params){
  const auth=authSql(sql);if(auth)return {rows:auth};
  if(sql.includes('FROM dimensions d LEFT JOIN observation_metrics'))return {rows:[{kind:'week',label:'current',completed_runs:10},{kind:'week',label:'previous',completed_runs:5},{kind:'day',label:'2026-10-24',completed_runs:2}]};
  if(sql.includes("('mixed'),('powered-cube'),('latest')"))return {rows:[{environment:'mixed',scheduled:true}]};
  if(sql.includes('snapshot.id IS NOT NULL cache_current'))return {rows:[{cache_current:true,revision:'21'}]};
  if(sql.includes('failed_publications'))return {rows:[{failed_publications:0,urgent_reports:0}]};
  if(sql.includes('FROM ranked')&&sql.includes('unexpected_choices'))return {rows:[{puzzle_id:'a'.repeat(32),answers:15,unexpected_choices:true}]};
  if(sql.includes('FROM keys k LEFT JOIN arrivals'))return {rows:[{source:'reddit',campaign:'launch',daily_starts:10,daily_completions:5,tracked_arrivals:20}]};
  throw Error('Unexpected dashboard SQL');
}
const request=path=>new Request('https://packone.pro'+path,{headers:{'x-pack1-auth-session':'synthetic-admin-token'}});
test('dashboard routes remain admin protected',async()=>{
  await assert.rejects(handleAdmin(request('/v1/admin/overview/trends'),async()=>({rows:[]}),async()=>({})),x=>x.status===403);
});
test('dashboard routes return bounded read-only reports',async()=>{
  for(const [path,key] of [['/v1/admin/overview/trends','weekly'],['/v1/admin/overview/health','dailies'],['/v1/admin/insights/quality-watch','rows'],['/v1/admin/campaign-performance','rows']]){
    const result=await handleAdmin(request(path),queryFixture,async()=>({}));
    assert.ok(Array.isArray(result[key]),path);
  }
  await assert.rejects(handleAdmin(request('/v1/admin/campaign-performance?from=2025-01-01&to=2026-10-24'),queryFixture,async()=>({})),x=>x.status===400);
});
test('trend changes handle zeros and rates use real denominators',()=>{
  assert.equal(trendChange(20,10),'+100.0%');
  assert.equal(trendChange(0,0),'No change');
  assert.equal(trendChange(4,0),'New activity');
  assert.match(trendsMarkup({weekly:[{label:'current',completed_runs:20,answers:40,trophy_matches:20},{label:'previous',completed_runs:10,answers:30,trophy_matches:6}],daily:[]}),/\+30\.0 pp/);
  assert.match(healthMarkup({day:'2026-10-24',dailies:[],serving:{cache_current:false},attention:{}}),/Needs attention/);
});
test('quality watchlist is advisory and guards small samples',async()=>{
  const {ADMIN_QUALITY_SQL}=await import('../worker/admin-dashboard.mjs');
  assert.match(ADMIN_QUALITY_SQL,/m\.answers>=12/);
  assert.match(ADMIN_QUALITY_SQL,/m\.mature_views>=12/);
  assert.match(ADMIN_QUALITY_SQL,/count\(DISTINCT player_id\)/);
  assert.match(ADMIN_QUALITY_SQL,/LIMIT 20/);
  assert.doesNotMatch(ADMIN_QUALITY_SQL,/UPDATE |DELETE FROM/);
});
