import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_ENVIRONMENTS,
  dailyGenerationErrorClass,
  generateDailyEnvironmentResults,
} from '../worker/daily-generation-results.mjs';

test('Daily generation attempts all environments and reports coarse failures',async()=>{
  const calls=[];
  const ensure=async(day,environment)=>{
    calls.push([day,environment]);
    if(environment==='mixed')throw Object.assign(new Error('fixture availability failure'),{status:503});
    if(environment==='latest')throw new Error('fixture database failure');
    return {created:false};
  };
  let tick=1000;
  const results=await generateDailyEnvironmentResults('2041-06-15',ensure,{now:()=>tick+=5});
  assert.deepEqual(calls.map(([,environment])=>environment),DAILY_ENVIRONMENTS);
  assert.deepEqual(results.map(row=>({environment:row.environment,status:row.status,error_class:row.error_class||null})),[
    {environment:'mixed',status:'failed',error_class:'availability_error'},
    {environment:'powered-cube',status:'already_exists',error_class:null},
    {environment:'latest',status:'failed',error_class:'internal_error'},
  ]);
  assert.ok(results.every(row=>Number.isFinite(row.duration_ms)&&row.duration_ms>=0));
});

test('Daily generation error classes are status-only and coarse',()=>{
  assert.equal(dailyGenerationErrorClass({status:503,message:'not enough puzzles'}),'availability_error');
  assert.equal(dailyGenerationErrorClass({status:409,message:'anything'}),'request_error');
  assert.equal(dailyGenerationErrorClass({status:500,message:'anything'}),'server_error');
  assert.equal(dailyGenerationErrorClass(new Error('database connection failed')),'internal_error');
});
