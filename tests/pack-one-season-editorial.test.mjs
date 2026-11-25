import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonResultsDue,midseasonDue,collectSeasonResults,summarizeGuideDecisions,guideGameOutcomes,seasonPostMetadata,PERFECT_AWARDS_SQL,CLOSED_SEASON_SQL} from '../scripts/pack-one-season-editorial.mjs';
import {seasonResultsMarkup,midseasonGuideMarkup} from '../scripts/pack-one-season-render.mjs';
import {FORMATS,addDays} from '../scripts/pack-one-weekly-data.mjs';
const old={id:'fixture',set_id:'fixture',set_name:'Fixture Set',start_date:'2026-11-10',end_date:'2026-12-09',successor_id:'next',successor_start:'2026-12-10'};
const active={...old,end_date:null};
const enable={enabledFrom:'2026-11-30'};
const now=new Date('2026-12-10T18:00:00Z');
const plan={seasonId:'fixture',nextSetId:'next',nextStart:'2026-12-10',reviewedOn:'2026-11-15'};
const midtime=new Date('2026-11-25T18:00:00Z');
const midEnable={enabledFrom:'2026-11-20'};
const gate=midseasonDue(active,plan,midtime,midEnable);
const brand={logo:'logo',ios:'ios',android:'android'};
test('close is the persisted successor day, after noon Central, with explicit activation and no backfill',()=>{
 assert.equal(seasonResultsDue(old,now,enable).key,'pack-one-season:results:fixture');
 assert.equal(seasonResultsDue(old,new Date('2026-12-10T17:59:59Z'),enable),null);
 assert.equal(seasonResultsDue(old,new Date('2026-12-11T18:00:00Z'),enable),null);
 assert.equal(seasonResultsDue(old,now),null);
 assert.equal(seasonResultsDue(old,now,{enabledFrom:'2026-12-11'}),null);
 assert.equal(seasonResultsDue({...old,successor_start:'2026-12-11'},now,enable),null);
 assert.equal(seasonResultsDue({...old,end_date:'2026-12-08'},now,enable),null);
 assert.match(CLOSED_SEASON_SQL,/last_reconciled_day>=next.start_date/);
 assert.match(CLOSED_SEASON_SQL,/next.set_release_date>old.set_release_date/);
});
test('midseason uses a reviewed next-start plan and only completed Pacific dates',()=>{
 assert.equal(gate.end,'2026-11-24');assert.equal(gate.key,'pack-one-season:guide:fixture');
 assert.equal(midseasonDue(active,null,midtime,midEnable),null);
 assert.equal(midseasonDue(old,plan,midtime,midEnable),null);
 assert.equal(midseasonDue(active,{...plan,reviewedOn:'2026-11-26'},midtime,midEnable),null);
 assert.equal(midseasonDue(active,plan,new Date('2026-11-26T18:00:00Z'),midEnable),null);
 assert.equal(seasonPostMetadata(gate).title,'Pack One Midseason Set Guide | Fixture Set');
});
test('season collector waits for privacy cutoff and reuses rating, fixed boards, ties and anonymous names',async()=>{
 const auth='11111111-1111-4111-8111-111111111111';
 const user='22222222-2222-4222-8222-222222222222';
 const hidden='33333333-3333-4333-8333-333333333333';
 const tied=[{rank:1,player_id:user,display_name:'Fixture Winner',score:96.5,average_score:98,days:21},
 {rank:1,player_id:hidden,display_name:'Fixture Hidden',score:96.5,average_score:98,days:21}];
 const calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql===CLOSED_SEASON_SQL)return {rows:[old]};
  if(sql.includes('pack1_results_launch'))return {rows:[{active:true,launch_at:'2026-11-16T15:33:00Z',first_publication_at:'2026-11-30T15:33:00Z'}]};
  if(sql.includes('WITH day_scores'))return {rows:tied};
  if(sql===PERFECT_AWARDS_SQL)return {rows:[{...tied[0],environment:'latest',perfect_days:3},{...tied[1],environment:'latest',perfect_days:3}]};
  if(sql.includes('SELECT auth_user_id::text AS auth_id FROM account_links'))return {rows:args[0]===user?[{auth_id:auth}]:[]};
  throw Error('unexpected fixture SQL');
 };
 // The privacy helper's exact SQL is stable; keep fixture independent of
 // its SQL string by detecting its returned column aliases.
 const fixtureQuery=async(sql,args)=>sql.includes('first_publication_at')?{rows:[{active:true,launch_at:'2026-11-16T15:33:00Z',first_publication_at:'2026-11-30T15:33:00Z'}]}:query(sql,args);
 const result=await collectSeasonResults(fixtureQuery,{now,enabledFrom:enable.enabledFrom,nameFor:async()=> 'Fixture Winner'});
 assert.deepEqual(result.article.seasonBoards.map(b=>b.environment),FORMATS);
 assert.equal(result.article.seasonBoards[0].rows[1].name,'Anonymous player');
 assert.equal(result.article.perfectAwards.length,2);
 assert.equal(result.article.perfectAwards[1].name,'Anonymous player');
 assert.ok(!JSON.stringify(result.article).includes(hidden));assert.ok(!JSON.stringify(result.article).includes('Fixture Hidden'));
 assert.equal(calls.filter(c=>c.sql.includes('WITH day_scores')).length,3);
 assert.ok(calls.filter(c=>c.sql.includes('WITH day_scores')).every(c=>c.args[0]===old.start_date&&c.args[1]===old.end_date&&c.args[8]!=null));
 const html=seasonResultsMarkup(result.article,brand);
 assert.equal((html.match(/class="weekly-winner"/g)||[]).length,6);
 assert.ok(html.indexOf('Draft Run')<html.indexOf('Powered Cube')&&html.indexOf('Powered Cube')<html.indexOf('Latest Set'));
 assert.match(html,/Most Perfect Dailies/);assert.doesNotMatch(html,/Fixture Hidden/);
});
const cards=[{id:'a',name:'Fixture A',image_url:'https://cards.scryfall.io/normal/front/a/a/a.jpg',rarity:'common',model_probability:.4},
 {id:'b',name:'Fixture B',image_url:'https://cards.scryfall.io/normal/front/b/b/b.jpg',rarity:'common',model_probability:.6}];
const rows=Array.from({length:30},(_,i)=>{
 const pick=i%2===0?2:4;
 return {day:addDays(gate.start,Math.floor(i/2)),environment:'latest',set_id:'fixture',puzzle_id:'fixture-'+i,pick_number:pick,payload:{historical_pick_id:'a',candidates:cards,prior_picks:Array.from({length:pick-1},()=>cards[0])},votes:{a:60,b:40}};
});
test('guide has broad coverage, separate denominators, two real packs and no raw identifiers',()=>{
 const d=summarizeGuideDecisions(rows,gate);
 assert.equal(d.coverage.decisions,30);assert.equal(d.early.trophyPct,60);assert.equal(d.early.modelPct,40);assert.equal(d.early.modelTrophyPct,0);
 assert.notEqual(d.examples[0].day,d.examples[1].day);assert.equal(d.examples[0].puzzleId,undefined);
 assert.equal(summarizeGuideDecisions(rows.slice(0,10),gate),null);
 assert.equal(summarizeGuideDecisions(rows.map(r=>({...r,votes:{a:20,b:20}})),gate),null);
 assert.equal(summarizeGuideDecisions(rows.map(r=>({...r,environment:'mixed'})),gate),null);
 assert.equal(summarizeGuideDecisions(rows.map(r=>({...r,payload:{...r.payload,candidates:cards.map(c=>({...c,model_probability:.5}))}})),gate),null);
 assert.equal(summarizeGuideDecisions([...rows,...rows],gate).coverage.decisions,30);
});
const outcomeRows=['WU','UB','BR','RG','GW','WB','UR','BG','RW','GU'].map((colors,i)=>({colors,games:1000,wins:520+i}));
const guide={id:'fixture',reviewedAt:'2026-11-24',results:{format:'PremierDraft',userGroup:'all',period:'ALL_TIME',splashes:false,colorCount:2,retrievedAt:'2026-11-24',sourceUrl:'https://www.17lands.com/deck_color_data?expansion=FIXTURE&format=PremierDraft&time_period=ALL_TIME&separate_splashes=true',rows:outcomeRows,baseline:{games:10000,wins:5245}}};
test('outcomes require reviewed recent matched cohort and same-sample baseline',()=>{
 const outcomes=guideGameOutcomes(guide,gate);
 assert.equal(outcomes.baseline.games,10000);assert.equal(outcomes.rows.length,10);
 assert.equal(guideGameOutcomes({...guide,guideStatus:'draft-unpublished'},gate),null);
 assert.equal(guideGameOutcomes({...guide,results:{...guide.results,retrievedAt:'2026-11-12'}},gate),null);
 assert.equal(guideGameOutcomes({...guide,results:{...guide.results,baseline:{games:10000,wins:1}}},gate),null);
 assert.equal(guideGameOutcomes({...guide,results:{...guide.results,userGroup:'top'}},gate),null);
 assert.equal(guideGameOutcomes({...guide,results:{...guide.results,sourceUrl:guide.results.sourceUrl.replace('PremierDraft','TradDraft')}},gate),null);
 const html=midseasonGuideMarkup({kind:'midseason-guide',start:gate.start,end:gate.end,seasonName:gate.name,decisions:summarizeGuideDecisions(rows,gate),outcomes},brand);
 assert.match(html,/Observed Draft Results/);assert.match(html,/Model preference/);assert.match(html,/Trophy pick/);
 assert.doesNotMatch(html,/fixture-0|Fixture Hidden/);
});
