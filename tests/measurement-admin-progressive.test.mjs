import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdmin} from '../worker/measurement-admin.mjs';

const USER='11111111-1111-4111-8111-111111111111';
const token='progressive-admin-test';
const request=section=>new Request('https://packone.pro/v1/admin/measurements?section='+section,{
  headers:{'x-pack1-auth-session':token}
});

function database() {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push(sql);
    if(sql.includes('FROM neon_auth.session s JOIN neon_auth."user"'))return {rows:[{token,user_id:USER}]};
    if(sql.includes('SELECT 1 FROM pack1_admins'))return {rows:[{ok:1}]};
    if(sql.includes('SELECT set_id FROM draft_run_verified_sets'))return {rows:[{set_id:'blb'}]};
    if(sql.includes('count(*)::int recorded'))return {rows:[{recorded:4,qa_excluded:0,unobserved_excluded:0,repeats_excluded:0,collection_started:null}]};
    if(sql.includes('count(DISTINCT session_id)::int runs'))return {rows:[{answers:4,runs:1,completed_runs:1}]};
    if(sql.includes('SELECT dimension,label'))return {rows:[{dimension:'set',label:'blb',answers:4}]};
    if(sql.includes('chosen AS'))return {rows:[{puzzle_id:'a'.repeat(32),set_id:'blb',pick_number:1,answers:4}]};
    if(sql.includes('WITH arrivals AS'))return {rows:[{arrivals:2,visitors:2,starts:1,completions:1,start_pct:50,completion_pct:100}]};
    if(sql.includes('WITH eligible_daily_sessions AS'))return {rows:[{cohorts:[],daily_health:[]}]};
    throw Error('Unexpected query: '+sql.slice(0,120));
  };
  return {query,calls};
}

const has=(calls,needle)=>calls.some(sql=>sql.includes(needle));

test('core admin report skips grouped analysis and engagement queries',async()=>{
  const db=database();
  const result=await handleAdmin(request('core'),db.query,async()=>({}));
  assert.equal(result.summary.answers,4);
  assert.deepEqual(result.groups,[]);
  assert.deepEqual(result.reviews,[]);
  assert.equal(result.share_funnel,undefined);
  assert.equal(has(db.calls,'SELECT dimension,label'),false);
  assert.equal(has(db.calls,'WITH eligible_daily_sessions AS'),false);
  assert.equal(has(db.calls,'WITH arrivals AS'),false);
});

test('analysis admin report runs only grouped and review work after auth',async()=>{
  const db=database();
  const result=await handleAdmin(request('analysis'),db.query,async()=>({}));
  assert.equal(result.groups[0].dimension,'set');
  assert.equal(result.reviews[0].set_id,'blb');
  assert.equal(has(db.calls,'count(*)::int recorded'),false);
  assert.equal(has(db.calls,'count(DISTINCT session_id)::int runs'),false);
  assert.equal(has(db.calls,'WITH eligible_daily_sessions AS'),false);
  assert.equal(has(db.calls,'WITH arrivals AS'),false);
});

test('engagement admin report skips decision measurement scans',async()=>{
  const db=database();
  const result=await handleAdmin(request('engagement'),db.query,async()=>({}));
  assert.equal(result.share_funnel.arrivals,2);
  assert.deepEqual(result.habit_metrics,{cohorts:[],daily_health:[]});
  assert.equal(has(db.calls,'draft_run_source_measurements'),false);
  assert.equal(has(db.calls,'SELECT dimension,label'),false);
});

test('legacy all report still returns every section',async()=>{
  const db=database();
  const result=await handleAdmin(request('all'),db.query,async()=>({}));
  assert.equal(result.summary.answers,4);
  assert.equal(result.groups[0].dimension,'set');
  assert.equal(result.share_funnel.arrivals,2);
  assert.deepEqual(result.habit_metrics,{cohorts:[],daily_health:[]});
});
