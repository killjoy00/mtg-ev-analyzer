import test from 'node:test';
import assert from 'node:assert/strict';
import {conservativeSeasonRating as rate,seasonRatingPolicy} from '../worker/season-rating.mjs';
import {draftRunLeaderboardRows} from '../worker/draft-run-season.mjs';
import {currentSeasonMarkup} from '../my-pack-one.mjs';

const policy=environment=>seasonRatingPolicy(environment,'2026-09-01');
const rating=(mean,days,environment='powered-cube')=>rate({sum:mean*days,days},policy(environment));

test('single results qualify, low scores never get boosted, and established evidence can beat a perfect debut',()=>{
  assert.equal(rating(0,1),0);
  assert.ok(Math.abs(rating(40,1)-34.62745249749556)<1e-8);
  assert.ok(rating(65,30)>rating(40,1));
  assert.ok(rating(82.18181818181819,11)>rating(100,1));
  assert.ok(rating(100,1)>0);
  assert.throws(()=>rate({sum:0,days:0},policy('mixed')));
});

test('rating never exceeds the mean, and higher mean or more equal-quality evidence never hurts',()=>{
  for(const environment of ['mixed','powered-cube','latest']) {
    for(let n=1;n<=84;n++)for(let mean=0;mean<=100;mean++) {
      const r=rating(mean,n,environment);
      assert.ok(r>=0&&r<=mean);
      if(mean<100)assert.ok(rating(mean+1,n,environment)>=r);
      assert.ok(rating(mean,n+1,environment)>=r);
    }
  }
});

test('all Dailies count, including a poor result after ten good ones',()=>{
  assert.ok(rate({sum:900,days:11},policy('mixed'))<rating(90,10,'mixed'));
  for(const n of [42,56,84])assert.ok(rating(90,n,'mixed')>rating(100,1,'mixed'));
});

test('policy is frozen, environment-specific and selected by season start',()=>{
  assert.deepEqual(policy('mixed'),{version:'conservative-season-v1',prior_days:5,penalty_multiplier:1.645,baseline:70,variability:15});
  assert.deepEqual(policy('latest'),policy('powered-cube'));
  assert.deepEqual(policy('mixed'),seasonRatingPolicy('mixed','2026-12-01'));
  assert.throws(()=>{policy('mixed').baseline=99;},TypeError);
  assert.throws(()=>seasonRatingPolicy('mixed'));
  assert.throws(()=>seasonRatingPolicy('invalid','2026-09-01'));
});

test('API exposes a full precision rating and rounded legacy score, mean and days',async()=>{
  let params;
  const rows=await draftRunLeaderboardRows(async(_,p)=>{
    params=p;
    return {rows:[{rank:'1',score:'62.7755520744305',average_score:'65.0',days:'30'}]};
  },{start:'2026-09-01',end:'2026-10-17',environment:'powered-cube',ratingPolicy:policy('powered-cube')});
  assert.deepEqual(params.slice(7),[null,80,5,13.16]);
  assert.deepEqual(rows,[{rank:1,score:62.8,rating:62.7755520744305,average_score:65,days:30}]);
  await assert.rejects(()=>draftRunLeaderboardRows(()=>{}, {bestOf:3,ratingPolicy:policy('mixed')}));
});

test('profile distinguishes rating from raw mean and still renders old responses',()=>{
  const render=row=>currentSeasonMarkup({current_season:{name:'Example',standings:[{environment:'mixed',rank:1,days:1,...row}]}});
  assert.match(render({average:34.6,rating:34.627,average_score:40}),/34.6 rating · 40.0 avg · 1 day/);
  assert.match(render({average:40}),/#1 · 40.0 · 1 day/);
});
