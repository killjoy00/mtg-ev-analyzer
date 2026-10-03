import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyTarget,recordQueries,summarize,queryFamily,sqlQuery} from '../scripts/practice-performance.mjs';
import {currentPracticeBatchPlan} from '../worker/draft-run-selection.mjs';
import {PRACTICE_RECENCY_HALF_LIFE,practiceSetWeight,chooseRunSet} from '../draft-run-policy.mjs';

const target={branch:'br-disposable',connection:'postgresql://fixture:secret@ep-fixture.us-east-2.aws.neon.tech/pack1',
  branchRecord:{id:'br-disposable',parent_id:'br-orange-feather-ayps8kep'},
  endpoints:[{branch_id:'br-disposable',type:'read_write',host:'ep-fixture.us-east-2.aws.neon.tech'}]};

test('benchmark refuses production/development and connections on a different branch',()=>{
  assert.equal(verifyTarget(target).host,'ep-fixture.us-east-2.aws.neon.tech');
  assert.equal(verifyTarget({...target,connection:target.connection.replace('ep-fixture.','ep-fixture-pooler.')}).host,'ep-fixture.us-east-2.aws.neon.tech');
  for(const branch of ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b','../../production'])assert.throws(()=>verifyTarget({...target,branch}));
  assert.throws(()=>verifyTarget({...target,connection:target.connection.replace('ep-fixture.','ep-production.')}));
  assert.throws(()=>verifyTarget({...target,endpoints:[{...target.endpoints[0],branch_id:'br-orange-feather-ayps8kep'}]}));
  assert.throws(()=>verifyTarget({...target,branchRecord:{...target.branchRecord,parent_id:'br-another'}}));
  assert.throws(()=>verifyTarget({...target,connection:target.connection.replace('/pack1','/other')}));
});

test('query measurement preserves results/parameters and records failed time without leaking errors',async()=>{
  let time=10;const response={rows:[{n:'100'}]},params=['sensitive-value'];
  const recorded=recordQueries(async(sql,actual)=>{assert.equal(actual,params);time=25;return response;},{clock:()=>time});
  assert.equal(await recorded.query('SELECT count(*) GROUP BY p.set_id,p.pick_number,r.band',params),response);
  assert.deepEqual(recorded.records,[{family:'group_counts',ms:15,rows:1,ok:true}]);
  const error=Object.assign(Error('provider-body-with-secret'),{status:503});
  const failed=recordQueries(async()=>{time=40;throw error;},{clock:()=>time});
  await assert.rejects(failed.query('WITH chosen AS (SELECT 1)'),cause=>cause===error);
  assert.deepEqual(failed.records,[{family:'candidate_and_trajectory',ms:15,ok:false,error:'http_503'}]);
  assert.doesNotMatch(JSON.stringify([...recorded.records,...failed.records]),/sensitive|secret|provider/);
});

test('coverage is distinct from puzzle group counts and percentiles retain sample counts',()=>{
  assert.equal(queryFamily('SELECT count(DISTINCT p.source_draft_hash) GROUP BY p.set_id,p.pick_number,r.band'),'custom_coverage');
  assert.equal(queryFamily('SELECT p.set_id FROM draft_run_environment_policy p JOIN corpus_set_versions v'),'live_set_metadata');
  assert.equal(queryFamily('SELECT * WHERE p.puzzle_id=ANY($2::text[])'),'metadata_reload');
  assert.deepEqual(summarize([]),{samples:0,p50_ms:null,p95_ms:null,p99_ms:null});
  assert.deepEqual(summarize([30,10,20]),{samples:3,p50_ms:20,p95_ms:30,p99_ms:30});
});

test('cache-build deadline is separate from ordinary benchmark requests and failures remain visible',async t=>{
  const deadlines=[];
  t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return new AbortController().signal;});
  const fetchImpl=async(endpoint,options)=>{
    assert.equal(endpoint,'https://api.us-east-2.aws.neon.tech/sql');
    assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);
    return {ok:true,json:async()=>({fields:[{name:'snapshot'}],rows:[['fixture']]})};
  };
  const ordinary=sqlQuery(target.connection,{fetchImpl});
  const build=sqlQuery(target.connection,{fetchImpl,timeoutMs:180000});
  assert.deepEqual(await ordinary('SELECT 1'),{rows:[{snapshot:'fixture'}]});
  await build('SELECT pack1_serving_snapshot($1,$2,$3) snapshot',['corpus','difficulty','policy']);
  await ordinary('SELECT pack1_select_serving_run_v1($1) selection',['fixture']);
  assert.deepEqual(deadlines,[90000,180000,90000]);

  const failure=new DOMException('provider-body-with-secret','TimeoutError');
  const recorded=recordQueries(sqlQuery(target.connection,{timeoutMs:180000,fetchImpl:async()=>{throw failure;}}));
  await assert.rejects(recorded.query('SELECT pack1_serving_snapshot($1,$2,$3) snapshot'),error=>error===failure);
  assert.equal(recorded.records[0].family,'serving_snapshot');
  assert.equal(recorded.records[0].error,'timeout');
  assert.equal(recorded.records[0].ok,false);
  assert.doesNotMatch(JSON.stringify(recorded.records),/secret|provider/);
});


test('current regular Practice sends gentle recency weights to the batched selector',()=>{
  const metadata=[
    {set_id:'hob',status:'Live',regular_run:true,release_date:'2026-08-14'},
    {set_id:'blb',status:'Live',regular_run:true,release_date:'2024-08-02'},
  ];
  const {plan}=currentPracticeBatchPlan({groups:[],metadata},'practice-recency-test','mixed',{day:'2026-10-02'});
  assert.equal(PRACTICE_RECENCY_HALF_LIFE,12);
  assert.equal(plan.set_weights.hob,1);
  assert.ok(Math.abs(plan.set_weights.blb-.5)<1e-12);
});

test('Live release metadata prevents older unlisted sets from receiving newest-set weights',()=>{
  const day='2026-10-02',metadata=[
    {set_id:'hob',status:'Live',regular_run:true,release_date:'2026-08-14'},
    {set_id:'vow',status:'Live',regular_run:true,release_date:'2021-11-19'},
    {set_id:'mid',status:'Live',regular_run:true,release_date:'2021-09-24'},
    {set_id:'future',status:'Live',regular_run:true,release_date:'2099-01-01'},
    {set_id:'candidate',status:'Candidate',regular_run:true,release_date:'2026-09-01'},
    {set_id:'powered-cube',status:'Live',regular_run:false,release_date:'2026-09-01'},
  ];
  const {plan}=currentPracticeBatchPlan({groups:[],metadata},'older-live-sets','mixed',{day});
  assert.equal(plan.set_weights.hob,1);
  assert.equal(plan.set_weights.vow,2**(-25/12));
  assert.equal(plan.set_weights.mid,2**(-26/12));
  assert.equal(plan.set_weights.future,undefined);
  assert.equal(practiceSetWeight('powered-cube',undefined,day,metadata),1);
  for(const id of ['hob','vow','mid'])assert.equal(plan.set_weights[id],practiceSetWeight(id,undefined,day,metadata));
  assert.equal(chooseRunSet(['hob','mid'],()=>.6,false,undefined,day,metadata),'hob');
  for(const version of ['balanced-v1','first-pack-v2','eight-pick-v3'])assert.equal(practiceSetWeight('mid',version,day,metadata),1);
  assert.equal(chooseRunSet(['hob','mid'],()=>.6,true,undefined,day,metadata),chooseRunSet(['hob','mid'],()=>.6,true,undefined,day));
});

test('practice recency migration is wired into performance and both guarded release stages',()=>{
  const migration=fs.readFileSync('migrations/0050_practice_recency_bias.sql','utf8');
  assert.match(migration,/p_plan->'set_weights'/);
  const performance=fs.readFileSync('.github/workflows/practice-performance.yml','utf8');
  assert.match(performance,/migrations\/0050_practice_recency_bias\.sql/);
  const release=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  assert.equal((release.match(/migrations\/0050_practice_recency_bias\.sql/g)||[]).length,2);
});
