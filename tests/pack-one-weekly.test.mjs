import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {weeklyDue,weeklyWindow,hardestDaily,easiestPick,topFive,pickOfWeek,assertNamedPublicationTime,FORMATS} from '../scripts/pack-one-weekly-data.mjs';
import {weeklyArticleMarkup,loadWeeklyBrand,STORE_LINKS} from '../scripts/pack-one-weekly-render.mjs';
import {weeklyPickGate,weeklyPickTitle,makeWeeklyPickFeed,checkFrozenWeeklyPick,refreshWeeklyPick,runWeeklyPickFeed,coverFor} from '../scripts/patreon-weekly-pick-feed.mjs';

const dates={mon:new Date('2026-11-30T18:00:00Z'),wed:new Date('2026-12-02T16:00:00Z'),thu:new Date('2026-12-03T16:00:00Z')};
const cards=['one','two','three'].map((id,i)=>({id,name:'Fixture card '+(i+1),image_url:'https://cards.scryfall.io/normal/front/a/b/'+id+'.jpg',rarity:'common',model_probability:.3}));
const row=(day='2026-11-27',environment='latest',votes={one:41,two:36,three:27})=>({day,environment,set_id:'fra',puzzle_id:'fixture-puzzle-'+day,round:2,pick_number:2,payload:{historical_pick_id:'two',candidates:cards,prior_picks:cards.slice(0,1)},votes});
const fixtureName='Fixture Leader';
const cover=Buffer.alloc(6000,1);cover[0]=255;cover[1]=216;cover[2]=255;

test('Monday noon Central and prior completed Pacific week; DST changes UTC hour',()=>{
 assert.deepEqual(weeklyWindow(dates.mon),{start:'2026-11-23',end:'2026-11-29'});
 assert.equal(weeklyDue(new Date('2026-11-30T17:59:59Z')),null);
 assert.equal(weeklyDue(dates.mon).key,'pack-one-weekly:recap:2026-11-29');
 assert.equal(weeklyDue(new Date('2026-12-01T18:00:00Z')),null);
 assert.equal(weeklyDue(new Date('2026-07-06T16:59:00Z')),null);
 assert.equal(weeklyDue(new Date('2026-07-06T17:00:00Z')).end,'2026-07-05');
 assert.deepEqual(FORMATS,['mixed','powered-cube','latest']);
});

test('named collection must wait for launch and original global cutoff',async()=>{
 const query=async()=>({rows:[{active:true,launch_at:'2026-11-16T15:33:00Z',first_publication_at:'2026-11-30T15:33:00Z'}]});
 await assert.rejects(()=>assertNamedPublicationTime(query,new Date('2026-11-30T15:32:59Z')),/weekly-privacy-cutoff/);
 await assertNamedPublicationTime(query,dates.mon);
 await assert.rejects(()=>assertNamedPublicationTime(async()=>({rows:[{active:false}]}),dates.mon),/weekly-privacy-cutoff/);
});

test('hardest Daily needs a full comparable week, sufficient sample, meaningful drop',()=>{
 const rows=Array.from({length:7},(_,i)=>({day:'2026-11-'+(23+i),environment:'mixed',runs:40,mean:i===6?73:83}));
 const hard=hardestDaily(rows);
 assert.equal(hard.day,'2026-11-29');
 assert.equal(hard.rest,83);
 assert.equal(hard.gap,10);
 assert.equal(hardestDaily(rows.slice(1)),null);
 assert.equal(hardestDaily(rows.map(r=>({...r,runs:10}))),null);
 assert.equal(hardestDaily(rows.map(r=>({...r,mean:83}))),null);
});
test('easiest pick uses trophy matches, full denominator, real card URLs',()=>{
 const easy=row('2026-11-25','latest',{one:2,two:98});
 const low=row('2026-11-26','mixed',{one:20,two:80});
 const noArt={...easy,payload:{...easy.payload,candidates:[...cards.slice(0,2),{...cards[2],image_url:'https://example.invalid/a'}]}};
 assert.equal(easiestPick([low,easy]).match_pct,98);
 assert.equal(easiestPick([low,easy]).trophy_name,'Fixture card 2');
 assert.equal(easiestPick([noArt]),null);
 assert.equal(easiestPick([row('2026-11-25','latest',{two:49})]),null);
 assert.equal(easiestPick([row('2026-11-25','latest',{two:98,unknown:2})]),null);
 assert.equal(topFive([{rank:1},{rank:2},{rank:5},{rank:5},{rank:7}]).length,4);
});

test('approved recap layout, first-place highlight, no hardest pick or season commentary, official footer',async()=>{
 const brand=await loadWeeklyBrand();
 const board=environment=>({environment,rows:[{rank:1,name:fixtureName,score:98.7,average_score:97.1,days:6}]});
 const markup=weeklyArticleMarkup({start:'2026-11-23',end:'2026-11-29',weekly:FORMATS.map(board).reverse(),perfectDailies:[],
  hardest:{...board('mixed'),day:'2026-11-29',mean:73,rest:83},
  easiest:easiestPick([row('2026-11-25','latest',{one:2,two:98})]),
  seasonName:'Fixture Set',seasonBoards:FORMATS.map(board)},brand);
 assert.match(markup,/Last Week&#39;s Weekly Winners/);
 assert.equal((markup.match(/class="weekly-winner"/g)||[]).length,3);
 assert.ok(markup.indexOf('week-mixed')<markup.indexOf('week-powered-cube')&&markup.indexOf('week-powered-cube')<markup.indexOf('week-latest'));
 assert.match(markup,/98% of you got this one right!/);
 assert.match(markup,/Trophy drafter:/);
 assert.match(markup,/id="hardest-daily"/);
 assert.doesNotMatch(markup,/A pick from the Daily|Hardest Pick|moved into|Oct 21–Nov 22/);
 assert.match(markup,/Fixture Set season/);
 assert.ok(markup.includes(STORE_LINKS.ios)&&markup.includes(STORE_LINKS.android)&&markup.includes('Play Pack One · packone.pro'));
 assert.ok(brand.logo.startsWith('data:image/svg+xml;base64,')&&brand.ios.startsWith('data:image/svg+xml;base64,')&&brand.android.startsWith('data:image/png;base64,'));
});

test('Wednesday and Thursday share one immutable weekly identity; all other days excluded',()=>{
 const wed=weeklyPickGate(dates.wed),thu=weeklyPickGate(dates.thu);
 assert.equal(wed.publication_day,'2026-12-02');
 assert.equal(wed.key,thu.key);assert.equal(wed.publication_day,thu.publication_day);
 assert.equal(wed.backup,false);assert.equal(thu.backup,true);
 assert.equal(weeklyPickGate(dates.mon),null);
 assert.equal(weeklyPickGate(new Date('2026-12-01T16:00Z')),null);
 assert.equal(weeklyPickGate(new Date('2026-12-04T16:00Z')),null);
 assert.equal(weeklyPickGate(new Date('2026-12-02T14:59Z')),null);
 assert.equal(weeklyPickGate(new Date('2026-07-08T14:00Z')).publication_day,'2026-07-08');
});
test('weekly debate selects previous-week qualifying split and freezes identical title/image',async()=>{
 const wed=weeklyPickGate(dates.wed),thu=weeklyPickGate(dates.thu);
 const feature=pickOfWeek([row('2026-11-24','mixed'),row()]);
 assert.equal(feature.environment,'latest');
 const feed=makeWeeklyPickFeed({feature,cover,gate:wed});
 assert.equal(feed.title,weeklyPickTitle(wed.end));
 assert.equal(feed.version,2);
 assert.equal(checkFrozenWeeklyPick(feed,thu),feed);
 assert.throws(()=>checkFrozenWeeklyPick({...feed,feature_day:'2026-11-30'},thu),/frozen-invalid/);
 const verified=await refreshWeeklyPick(feed,wed,{now:dates.wed,find:async()=>({url:'https://www.patreon.com/posts/123'})});
 const backup=await refreshWeeklyPick(verified,thu,{now:dates.thu,find:async()=>({url:'https://www.patreon.com/posts/123'})});
 assert.equal(backup.title,verified.title);assert.equal(backup.image_sha256,verified.image_sha256);
 await assert.rejects(()=>refreshWeeklyPick(verified,thu,{find:async()=>null}),/public-receipt-missing/);
 await assert.rejects(()=>refreshWeeklyPick(feed,thu,{find:async()=>{throw Error('unavailable');}}),/unavailable/);
});
test('Thursday recovery does not regenerate an already frozen post',async()=>{
 const gate=weeklyPickGate(dates.wed);
 const feed=makeWeeklyPickFeed({feature:pickOfWeek([row()]),cover,gate});
 const env={GITHUB_EVENT_NAME:'schedule',GITHUB_TOKEN:'fixture',PATREON_CREATOR_ACCESS_TOKEN:'fixture'};
 const writes=[];
 const result=await runWeeklyPickFeed({env,now:dates.thu,attest:async()=>{},read:async()=>({content:Buffer.from(JSON.stringify(feed)).toString('base64')}),readRows:async()=>assert.fail('frozen data must not be recomputed'),render:async()=>assert.fail('frozen media must not be regenerated'),find:async()=>({url:'https://www.patreon.com/posts/123'}),write:async x=>writes.push(x)});
 assert.equal(result.status,'verified');
 assert.equal(writes.length,1);
 assert.equal(writes[0].feed.title,feed.title);
 assert.equal(writes[0].cover,undefined);
 const skipped=await runWeeklyPickFeed({env,now:dates.mon,attest:async()=>assert.fail('no access outside window')});
 assert.equal(skipped.status,'outside-window');
});
test('only an aggregate weekly pick workflow writes public media; no named recap CLI or artifact',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/patreon-desktop-feed.yml',import.meta.url),'utf8');
 assert.match(workflow,/3,4'/);
 assert.doesNotMatch(workflow,/collectWeeklyRecap|captureWeeklyRecap|upload-artifact/);
 const named=readFileSync(new URL('../scripts/pack-one-weekly-data.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(named,/console\.log|process\.argv|writeFile/);
});


test('weekly pick cover completes the asynchronous screenshot before closing Chromium',async()=>{
 const feature=pickOfWeek([row()]);
 assert.ok(feature);
 let closed=false,screenshots=0;
 const page={route:async()=>{},setContent:async()=>{},evaluate:async()=>true,locator:selector=>{
  assert.equal(selector,'.cover');
  return {screenshot:async()=>{screenshots++;await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);return cover;}};
 }};
 const chromiumImpl={launch:async()=>({newPage:async()=>page,close:async()=>{closed=true;}})};
 assert.equal(await coverFor(feature,{chromiumImpl}),cover);
 assert.equal(screenshots,1);assert.equal(closed,true);
});
