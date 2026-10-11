import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  INSIGHTS_SQL, INSIGHTS_SESSION_LIMIT, aggregateDraftRunInsights, validateInsightsFilters, loadDraftRunInsights,
} from '../worker/draft-run-insights.mjs';

const now=new Date('2026-12-25T12:00:00Z');
function row(n,{environment='mixed',score=72,pick=1,band='medium',time,puzzle,match=false}={}) {
  return {
    session_id:'session-'+Math.floor(n/8),puzzle_id:puzzle||'puzzle-'+environment+'-'+n,
    environment,pick_number:pick,score,trophy_match:match,
    answered_at:time||new Date(Date.UTC(2026,8,1)+n*86400000).toISOString(),
    difficulty_band:band,scoring_version:'trophy-consensus-v3-linear-v2',
    selection_version:'eight-pick-v4',corpus_version:'elite-trophy-colour-stage-v9',
  };
}
const result=(rows,filters={})=>aggregateDraftRunInsights(rows,{now,...filters});

test('insights query is bounded, owner-scoped and selects only eight-pick original answers',()=>{
  assert.equal(INSIGHTS_SESSION_LIMIT,1000);
  for(const fragment of [
    /s\.player_id=\$1::uuid/,/NOT s\.measurement_qa/,/p\.display_name !~\*/,
    /jsonb_array_length\(s\.puzzle_ids\)=8/,
    /s\.selection_version IN \('eight-pick-v3','eight-pick-v4'\)/,
    /ORDER BY s\.created_at DESC,s\.id DESC\s+LIMIT 1000/,
    /jsonb_array_elements\(s\.answers\) WITH ORDINALITY/,
    /o\.session_id=s\.id AND o\.round=picked\.ordinality::int AND o\.outcome='pick'/,
    /o\.answered_at/,/r\.difficulty_version='support-ratio-v1'/,/LIMIT 8000/,
  ])assert.match(INSIGHTS_SQL,fragment);
  assert.doesNotMatch(INSIGHTS_SQL,/UPDATE |DELETE |INSERT |TRUNCATE /i);
});

test('API rejects invalid filters before issuing any query and never accepts a client player ID',async()=>{
  for(const environment of ['all','cube','?','mixed OR 1=1']){
    assert.throws(()=>validateInsightsFilters({environment}),error=>error.status===400);
  }
  for(const period of ['year','10000d','tomorrow'])assert.throws(()=>validateInsightsFilters({period}),error=>error.status===400);
  let reads=0;
  await assert.rejects(()=>loadDraftRunInsights(async()=>{reads++;return {rows:[]};},'owner',{environment:'wrong'}),error=>error.status===400);
  assert.equal(reads,0);
  const owner='00000000-0000-4000-8000-000000000001';
  const response=await loadDraftRunInsights(async(sql,args)=>{
    assert.equal(sql,INSIGHTS_SQL);assert.deepEqual(args,[owner]);reads++;return {rows:[row(0)]};
  },owner,{environment:'mixed'});
  assert.equal(reads,1);
  assert.equal(response.eligible_decisions,1);
});

test('unlock at eight first-time picks, and group minimum is five with 0 score preserved',()=>{
  const picks=Array.from({length:8},(_,i)=>row(i,{score:i%2?100:0,pick: i<4?2:3,match:i%2!==0}));
  assert.equal(result(picks.slice(0,7)).unlocked,false);
  const full=result(picks);
  assert.equal(full.unlocked,true);
  assert.equal(full.eligible_decisions,8);
  assert.equal(full.pick_depth.length,2);
  assert.equal(full.pick_depth[0].count,4);
  assert.equal(full.pick_depth[0].average_score,null);
  assert.equal(full.pick_depth[1].average_score,null);
  assert.equal(full.formats.find(f=>f.environment==='mixed').average_score,50);
  assert.equal(full.formats.find(f=>f.environment==='mixed').trophy_match_pct,50);
  const five=result(picks.slice(0,5));
  assert.equal(five.pick_depth.find(p=>p.pick_number===2).count,4);
  assert.equal(result(Array.from({length:5},(_,i)=>row(i,{pick:2,score:20}))).pick_depth[0].average_score,20);
});

test('per-puzzle first encountered answer wins across environments, rerolls and duplicate joins are excluded',()=>{
  const first=row(1,{puzzle:'repeat',score:18,time:'2026-10-01T05:00:00Z'});
  const retry=row(2,{puzzle:'repeat',score:99,time:'2026-10-02T05:00:00Z',environment:'latest'});
  const badTime=row(3,{time:undefined,puzzle:'bad-time',score:98});badTime.answered_at=null;
  const badScore=row(4,{puzzle:'bad-score',score:120});
  const missingMatch=row(5,{puzzle:'bad-match'});missingMatch.trophy_match=null;
  const resultRow=result([retry,badTime,badScore,missingMatch,first,first]);
  assert.equal(resultRow.total_eligible_decisions,1);
  assert.equal(resultRow.eligible_decisions,1);
  assert.equal(resultRow.formats.find(x=>x.environment==='latest').count,0);
  assert.equal(resultRow.formats.find(x=>x.environment==='mixed').count,1);
  assert.equal(resultRow.range.from,'2026-10-01');
});

test('source pick number is used literally, including Powered Cube P1P2 and P1P9',()=>{
  const cube=Array.from({length:8},(_,i)=>row(i,{environment:'powered-cube',pick:i+2,score:75}));
  const got=result(cube,{environment:'powered-cube'});
  assert.deepEqual(got.pick_depth.map(x=>x.label),['P1P2','P1P3','P1P4','P1P5','P1P6','P1P7','P1P8','P1P9']);
  assert.equal(got.unlocked,true);
  assert.equal(result(cube,{environment:'mixed'}).unlocked,false);
  const historicalPractice=result([row(10,{pick:10}),row(11,{pick:11})],{environment:'mixed'});
  assert.deepEqual(historicalPractice.pick_depth.map(x=>x.pick_number),[10,11]);
});

test('a Pacific month requires ten counted decisions and marks smaller groups insufficient',()=>{
  const items=Array.from({length:10},(_,i)=>row(i,{time:'2026-10-'+String(i+1).padStart(2,'0')+'T12:00:00Z',score:80}));
  assert.equal(result(items.slice(0,9)).months.length,0,'under-sampled month is absent from the progress chart');
  assert.equal(result(items).months[0].average_score,80);
  assert.equal(result(items).months[0].count,10);
  const boundary=row(12,{time:'2026-11-01T03:15:00Z'});
  assert.equal(result([...items,boundary]).months[0].count,11,'UTC November 1 is still October in Pacific time');
});

test('progress requires 80 picks and uses latest 40 vs preceding 40 with dates',()=>{
  const items=Array.from({length:80},(_,i)=>row(i,{score:i<40?65:80}));
  assert.equal(result(items.slice(0,79)).progress,null);
  const p=result(items).progress;
  assert.ok(p);
  assert.equal(p.previous.count,40);
  assert.equal(p.recent.count,40);
  assert.equal(p.previous.average_score,65);
  assert.equal(p.recent.average_score,80);
  assert.equal(p.delta,15);
  assert.match(p.previous.from,/^2026-/);
  assert.match(p.recent.to,/^2026-/);
  assert.ok(result(items).observations.some(x=>x.id==='progress'));
});

test('observation requires 40 on each side and a gap of at least ten; maximum three',()=>{
  const sample=(a,b)=>[...Array.from({length:a},(_,i)=>row(i,{pick:2,score:60,band:'easy'})),
    ...Array.from({length:b},(_,i)=>row(100+i,{pick:7,score:70,band:'hard'}))];
  assert.equal(result(sample(39,40)).observations.length,0);
  assert.ok(result(sample(40,40)).observations.some(x=>x.id==='pick-depth'));
  const justNine=[...Array.from({length:40},(_,i)=>row(i,{pick:2,score:60})),
    ...Array.from({length:40},(_,i)=>row(100+i,{pick:7,score:69}))];
  assert.equal(result(justNine).observations.length,0,'nine points is too small for a written comparison');
  const many=[...sample(45,45),...Array.from({length:48},(_,i)=>row(200+i,{environment:'latest',score:95}))];
  assert.ok(result(many).observations.length<=3);
});

test('format cohorts and windows use selected environment and period, with unknown difficulty honest',()=>{
  const sample=[...Array.from({length:8},(_,i)=>row(i,{band:'unknown',score:88})),
    ...Array.from({length:9},(_,i)=>row(100+i,{environment:'latest',score:80}))];
  const r=result(sample,{environment:'mixed',period:'all'});
  assert.equal(r.unknown_difficulty,8);
  assert.equal(r.difficulty[0].band,'unknown');
  assert.equal(r.formats.find(f=>f.environment==='latest').count,9);
  assert.equal(r.formats.find(f=>f.environment==='powered-cube').average_score,null);
  assert.equal(result(sample,{environment:'mixed',period:'90d'}).eligible_decisions,0);
  assert.match(r.methodology,/1,000 recent/);
});

test('no public exposure or disabled old local-tab paths',()=>{
  const worker=fs.readFileSync('worker/growth-function.js','utf8');
  const gateway=fs.readFileSync('edge/gateway.mjs','utf8');
  assert.match(worker,/handleMyInsights\(request,\{mobile:true\}\)/);
  assert.match(worker,/authenticatedProfilePlayer\(request,\{mobile\}\)/);
  assert.match(worker,/url\.pathname === '\/v1\/profile\/insights'/);
  assert.match(gateway,/\/v1\/profile\/insights/);
  assert.match(gateway,/\/v1\/mobile\/profile\/insights/);
  assert.doesNotMatch(worker,/handlePublicProfile\([^)]*insights/);
});
