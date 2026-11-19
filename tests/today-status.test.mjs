import test from 'node:test';
import assert from 'node:assert/strict';

import { gameDateKey, todayStatus, nextUnfinishedDaily, completedAllDailies } from '../today-status.mjs';

test('Today uses the same Pacific calendar boundary as ranked Dailies', () => {
  assert.equal(gameDateKey(new Date('2026-09-14T06:59:59Z')), '2026-09-13');
  assert.equal(gameDateKey(new Date('2026-09-14T07:00:00Z')), '2026-09-14');
});

test('Today summarizes Draft Run and Cube independently without starting a run', () => {
  const profile = {
    summary: { current_streak: 4 },
    daily_history: [
      { date:'2026-09-13', mode:'draft_run', set_id:'mixed', score:84, rank:3, total:18, percentile:17 },
      { date:'2026-09-12', mode:'draft_run', set_id:'powered-cube', score:76, rank:4, total:12, percentile:34 },
    ],
  };
  const status = todayStatus(profile, '2026-09-13');
  assert.equal(status.completed, 1);
  assert.equal(status.streak, 4);
  assert.deepEqual(status.draftRun, { complete:true, score:84, rank:3, total:18, percentile:17 });
  assert.deepEqual(status.cube, { complete:false, score:null, rank:null, total:null, percentile:null });
});

const today='2026-10-11', now=new Date('2026-10-11T17:00:00Z');
const finished=environment=>({date:today,mode:'draft_run',set_id:environment,score:89});
const nextFor=(daily_history,completedEnvironment='mixed',extra={})=>nextUnfinishedDaily(
  {day:today,daily_history,...extra},
  {completedDay:today,completedEnvironment,now},
);

test('a finished main Daily leads directly to unfinished Cube, then Latest Set',()=>{
  assert.deepEqual(nextFor([finished('mixed')]),{
    environment:'powered-cube',key:'cube',label:'Play Daily Powered Cube',
    href:'?game=draft-run&set=powered-cube&daily=1',
  });
  assert.equal(nextFor([finished('mixed'),finished('powered-cube')]).label,'Play Daily Latest Set');
  assert.equal(nextFor([finished('mixed'),finished('powered-cube')]).href,'?game=draft-run&set=latest&daily=1');
});

test('the next Daily follows the homepage order, not the current run environment',()=>{
  assert.deepEqual(nextFor([finished('powered-cube')],'powered-cube'),{
    environment:'mixed',key:'draftRun',label:'Play Daily Draft Run',
    href:'?game=draft-run&daily=1',
  });
  assert.equal(nextFor([finished('mixed'),finished('latest')],'latest').environment,'powered-cube');
  assert.equal(nextFor([finished('mixed'),finished('powered-cube'),finished('latest')]),null);
});

test('a just-completed run is never offered again if the Daily status is briefly behind',()=>{
  assert.equal(nextFor([], 'mixed').environment,'powered-cube');
  assert.equal(nextFor([], 'powered-cube').environment,'mixed');
  assert.equal(nextFor([], 'latest').environment,'mixed');
});

test('only the correct Pacific date and draft-run history count toward next Daily',()=>{
  const mixed=finished('mixed');
  assert.equal(nextFor([mixed,{...finished('powered-cube'),date:'2026-10-10'}]).environment,'powered-cube');
  assert.equal(nextFor([mixed,{...finished('powered-cube'),mode:'top3'}]).environment,'powered-cube');
  assert.equal(nextFor([mixed,{...finished('powered-cube'),set_id:'latest'}]).environment,'powered-cube');
  assert.equal(nextFor([mixed,finished('powered-cube')],'mixed').environment,'latest');
  assert.equal(nextUnfinishedDaily({day:today,daily_history:[mixed]},{
    completedDay:'2026-10-10',completedEnvironment:'mixed',now,
  }),null,'older completed Dailies must not trigger a new-day deep link');
  assert.equal(nextUnfinishedDaily({day:today,daily_history:[mixed]},{
    completedDay:today,completedEnvironment:'mixed',now:new Date('2026-10-12T07:00:00Z'),
  }),null,'Pacific midnight invalidates the old next-Daily suggestion');
});

test('missing, stale or untrusted progress keeps the safe Back to Dailies fallback',()=>{
  const opts={completedDay:today,completedEnvironment:'mixed',now};
  assert.equal(nextUnfinishedDaily(null,opts),null);
  assert.equal(nextUnfinishedDaily({day:today},opts),null);
  assert.equal(nextUnfinishedDaily({day:'2026-10-10',daily_history:[]},opts),null);
  assert.equal(nextUnfinishedDaily({day:today,daily_history:[]},{...opts,completedEnvironment:'untrusted'}),null);
});

const allDoneFor=(daily_history,completedEnvironment='mixed',options={})=>completedAllDailies(
  {day:today,daily_history},
  {completedDay:today,completedEnvironment,now,...options},
);

test('all three Dailies are complete only on the result that finishes today\'s set',()=>{
  assert.equal(allDoneFor([finished('mixed')]),false,'one of three');
  assert.equal(allDoneFor([finished('mixed'),finished('powered-cube')],'powered-cube'),false,'two of three');
  assert.equal(allDoneFor([finished('mixed'),finished('powered-cube'),finished('latest')],'latest'),true,'three of three');
});

test('the set completes in any order and counts the result on screen if history lags',()=>{
  assert.equal(allDoneFor([finished('latest'),finished('mixed'),finished('powered-cube')],'powered-cube'),true);
  assert.equal(allDoneFor([finished('latest'),finished('powered-cube')],'mixed'),true);
  assert.equal(allDoneFor([finished('latest')],'mixed'),false);
});

test('yesterday, other modes, a past result or a stale status never complete today\'s set',()=>{
  const yesterday=environment=>({...finished(environment),date:'2026-10-10'});
  assert.equal(allDoneFor([yesterday('mixed'),yesterday('powered-cube'),finished('latest')],'latest'),false);
  assert.equal(allDoneFor([{...finished('mixed'),mode:'top3'},finished('powered-cube')],'latest'),false);
  const all=[finished('mixed'),finished('powered-cube'),finished('latest')];
  assert.equal(allDoneFor(all,'latest',{completedDay:'2026-10-10'}),false,'a previous day\'s result');
  assert.equal(allDoneFor(all,'latest',{now:new Date('2026-10-12T07:00:00Z')}),false,'Pacific midnight resets it');
  assert.equal(completedAllDailies({day:'2026-10-10',daily_history:all},{completedDay:today,completedEnvironment:'latest',now}),false);
  assert.equal(completedAllDailies(null,{completedDay:today,completedEnvironment:'latest',now}),false);
  assert.equal(allDoneFor(all,'untrusted'),false);
});
