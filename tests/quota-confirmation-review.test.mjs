import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeConfirmation,CONFIRMATION_PLAN} from '../scripts/quota-latency-confirmation.mjs';
import {reviewQuotaConfirmation} from '../scripts/review-quota-confirmation.mjs';
const metric=(samples,p95,p99)=>({samples,p50_ms:1,p95_ms:p95,p99_ms:p99,gt_1000ms:0});
const stats=(samples=128)=>({client:metric(samples,100,200),handler:metric(samples,20,30)});
function fixture(){
  const repetitions=CONFIRMATION_PLAN.map((comparison,i)=>({repeat:i+1,comparison,
    baseline:stats(1024),right:{client:metric(1024,80,150),handler:metric(1024,15,25)},
    counter_write_decisions:{baseline:1032,right:comparison==='aa'?1032:136},
    cohorts:Array.from({length:8},(_,j)=>({cohort:j+1,baseline:stats(),right:{client:metric(128,80,150),handler:metric(128,15,25)}}))}));
  return {source:'synthetic-quota-only',profile:'fixed-aa-ab-crossover-v2',placement:'same-actor-shared-counter',
    requests:8256,plan:[...CONFIRMATION_PLAN],repetitions,analysis:analyzeConfirmation(repetitions),production_ready:false};
}
test('offline review separates strict ties from observed regressions without changing the gate',()=>{
  const report=fixture(),cohorts=report.repetitions[1].cohorts;
  cohorts[0].right.handler.p95_ms=20;
  cohorts[1].right.handler.p99_ms=31;
  cohorts[2].right.client.p99_ms=220;
  report.analysis=analyzeConfirmation(report.repetitions);
  const review=reviewQuotaConfirmation(report),ab=review.comparisons[1];
  assert.equal(ab.improving_cohorts,5);assert.equal(review.latency_confirmation_passed,false);
  assert.equal(ab.failed_cohorts[0].failed_criteria[0].reason,'strict_improvement_tied');
  assert.equal(ab.failed_cohorts[0].failed_criteria[0].delta_ms,0);
  assert.equal(ab.failed_cohorts[1].failed_criteria[0].reason,'measured_regression');
  assert.equal(ab.failed_cohorts[1].failed_criteria[0].delta_ms,1);
  assert.equal(review.requests_reexecuted,0);assert.equal(review.production_ready,false);
});
test('a passing latency result still cannot authorize production',()=>{
  const review=reviewQuotaConfirmation(fixture());
  assert.equal(review.latency_confirmation_passed,true);assert.equal(review.production_ready,false);
  assert.ok(review.limitations.some(x=>x.includes('not a confidence interval')));
});
test('reported pass flags, altered plans and duplicate cohort evidence are rejected',()=>{
  const bad=fixture();bad.repetitions[1].cohorts[0].right.handler.p99_ms=99;
  bad.analysis.latency_confirmation_passed=false;
  assert.throws(()=>reviewQuotaConfirmation(bad),/decision does not match/);
  const duplicate=fixture();duplicate.repetitions[1].cohorts[1].cohort=1;
  assert.throws(()=>reviewQuotaConfirmation(duplicate),/cohort identity/);
  const wrongPlan=fixture();wrongPlan.requests--;
  assert.throws(()=>reviewQuotaConfirmation(wrongPlan),/request plan/);
  const missing=fixture();delete missing.repetitions[2].cohorts[0].right.handler.p99_ms;
  assert.throws(()=>reviewQuotaConfirmation(missing),/invalid_confirmation_metric/);
});
test('synthetic write evidence remains descriptive rather than a billing claim',()=>{
  const review=reviewQuotaConfirmation(fixture());
  assert.equal(review.comparisons[1].reported_counter_write_reduction,1-136/1032);
  assert.ok(review.limitations.some(x=>x.includes('not total billed operations')));
  const invalid=fixture();invalid.repetitions[1].counter_write_decisions.right=-1;
  assert.throws(()=>reviewQuotaConfirmation(invalid),/write decisions/);
});
