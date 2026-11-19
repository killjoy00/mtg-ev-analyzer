import test from 'node:test';
import assert from 'node:assert/strict';
import {createDailyScheduleEnsurer} from '../worker/draft-run-daily.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const schedule=()=>({puzzle_ids:['one','two'],scoring_version:'pinned',daily_featured_sets:['hob']});

test('overlapping Daily generation shares work and isolates returned schedules',async()=>{
  const gate=deferred(),query=()=>{},calls=[];
  const ensure=createDailyScheduleEnsurer(async(...args)=>{calls.push(args);await gate.promise;return {schedule:schedule(),created:true};});
  const requests=Array.from({length:20},()=>ensure(query,'2041-06-15','latest'));
  await Promise.resolve();assert.equal(calls.length,1);gate.resolve();
  const results=await Promise.all(requests);
  assert.equal(results.filter(r=>r.created).length,1);
  assert.ok(results.every(r=>r.schedule.scoring_version==='pinned'));
  results[0].schedule.puzzle_ids.push('changed');results[0].schedule.daily_featured_sets[0]='changed';
  assert.deepEqual(results[1].schedule,schedule());
  await ensure(query,'2041-06-15','latest');
  assert.equal(calls.length,2,'completed work is not a stale schedule cache');
});

test('Daily generation is scoped by database adapter, date and environment',async()=>{
  const gate=deferred(),query=()=>{},other=()=>{},calls=[];
  const ensure=createDailyScheduleEnsurer(async(...args)=>{calls.push(args);await gate.promise;return {schedule:schedule(),created:false};});
  const requests=[
    ensure(query,'2041-06-15','latest'),ensure(query,'2041-06-15','latest'),
    ensure(other,'2041-06-15','latest'),ensure(query,'2041-06-16','latest'),
    ensure(query,'2041-06-15','mixed'),
  ];
  await Promise.resolve();assert.equal(calls.length,4);gate.resolve();
  assert.ok((await Promise.all(requests)).every(r=>r.created===false));
});

test('failed Daily generation rejects all waiters and permits a fresh retry',async()=>{
  const gate=deferred(),query=()=>{},failure=Object.assign(new Error('unavailable'),{status:503});let calls=0;
  const ensure=createDailyScheduleEnsurer(async()=>{
    if(++calls===1)await gate.promise;
    return {schedule:schedule(),created:true};
  });
  const settled=Promise.allSettled([ensure(query,'2041-06-15','latest'),ensure(query,'2041-06-15','latest')]);
  await Promise.resolve();gate.reject(failure);
  const results=await settled;
  assert.ok(results.every(r=>r.status==='rejected'&&r.reason===failure));
  assert.equal((await ensure(query,'2041-06-15','latest')).created,true);
  assert.equal(calls,2);
});
