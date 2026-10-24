import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_FEATURED_PEERS,FEATURED_SQL,pacificDay,previousPacificDay,
 selectFeaturedPick,featureCopies,featuredBlueskyRkey,featureLink,
 formatPercent,imageUrl} from '../scripts/featured-pick.mjs';
import {blueskyDailyRkey} from '../scripts/post-daily-social.mjs';
import {featuredYoutubeMetadata} from '../scripts/publish-featured-pick.mjs';

const img=id=>'https://cards.scryfall.io/normal/front/a/b/'+id+'.jpg';
function row(environment,sets,trophy,{puzzle_id='puzzle',round=4,pick_number=4}={}) {
 const cards=sets.map(([id,n])=>({id,name:id.toUpperCase(),image_url:img(id),
  model_probability:0.5}));
 return {environment,puzzle_id,round,pick_number,set_id:environment==='latest'?'fra':'powered-cube',
  payload:{historical_pick_id:trophy,candidates:cards,prior_picks:[cards[0]]},
  votes:Object.fromEntries(sets.map(([id,n])=>[id,n]))};
}
const latest3=row('latest',[['mind',57],['inferno',46],['fates',21],['other',9],['extra',2]],'fates',
 {puzzle_id:'latest-3'});
const cube3=row('powered-cube',[['priest',49],['pyromancer',39],['triome',27],['star',2]],'priest',
 {puzzle_id:'cube-3'});
const latest2=row('latest',[['multiply',73],['oculus',62],['land',3],['pia',3],['stray',4]],'oculus',
 {puzzle_id:'latest-2',round:1,pick_number:1});
test('the three-way preference outranks two-way, then favors Latest Set within the same tier',()=>{
 const picked=selectFeaturedPick([cube3,latest2,latest3],{day:'2026-10-23'});
 assert.equal(picked.environment,'latest');
 assert.equal(picked.tier,3);
 assert.equal(picked.puzzle_id,'latest-3');
 assert.equal(picked.players,135);
 assert.equal(picked.trophy.name,'FATES');
 assert.deepEqual(picked.choices.map(c=>c.votes),[57,46,21]);
 assert.equal(picked.other_votes,11);
});
test('a genuine cube three-way beats Latest Set two-way',()=>{
 const picked=selectFeaturedPick([latest2,cube3],{day:'2026-10-23'});
 assert.equal(picked.environment,'powered-cube');
 assert.equal(picked.tier,3);
 assert.equal(picked.players,117);
});
test('two-way fallback favors Latest Set even with a closer Cube split',()=>{
 const cube=row('powered-cube',[['a',49],['b',48],['c',3]],'b');
 const picked=selectFeaturedPick([cube,latest2],{day:'2026-10-23'});
 assert.equal(picked.environment,'latest');
 assert.equal(picked.tier,2);
});
test('does not manufacture controversy from few peers or one clear favorite',()=>{
 const tiny=row('latest',[['a',12],['b',10],['c',8]],'a');
 const obvious=row('latest',[['a',95],['b',3],['c',2]],'a');
 assert.equal(selectFeaturedPick([tiny,obvious],{day:'2026-10-23'}),null);
});
test('refuses off-domain images and invalid denominator',()=>{
 assert.equal(imageUrl('https://evil.example/card.jpg'),null);
 assert.equal(imageUrl('javascript:alert(1)'),null);
 const invalid=structuredClone(latest3);
 invalid.payload.candidates[0].image_url='https://evil.example/card.jpg';
 assert.equal(selectFeaturedPick([invalid],{day:'2026-10-23'}),null);
});
test('strict Daily-only, account-deduplicated, QA-excluded vote SQL',()=>{
 assert.match(FEATURED_SQL,/s\.day=\$1::date/);
 assert.match(FEATURED_SQL,/NOT s\.measurement_qa/);
 assert.match(FEATURED_SQL,/COALESCE\(s\.daily_account_id::text,s\.player_id::text\)/);
 assert.match(FEATURED_SQL,/o\.outcome='pick'/);
 assert.match(FEATURED_SQL,/d\.round=o\.round/);
});
test('Pacific yesterday respects DST, year boundaries, and only completed prior day',()=>{
 assert.equal(pacificDay(new Date('2026-10-24T16:00:00Z')),'2026-10-24');
 assert.equal(previousPacificDay(new Date('2026-10-24T16:00:00Z')),'2026-10-23');
 assert.equal(previousPacificDay(new Date('2027-01-01T18:00:00Z')),'2026-12-31');
 assert.equal(previousPacificDay(new Date('2026-03-08T17:00:00Z')),'2026-03-07');
});
test('Bluesky has independent TID, link facets, bounded copy; Patreon has real text',()=>{
 const f=selectFeaturedPick([latest3],{day:'2026-10-23'});
 const copy=featureCopies(f);
 assert.match(copy.bluesky,/3 ways/);
 assert.match(copy.bluesky,/FATES/);
 assert.ok([...copy.bluesky].length<=300);
 assert.match(copy.discord,/\|\|FATES\|\|/);
 assert.match(copy.patreon,/135 distinct Pack One players/);
 assert.match(featureLink('bluesky'),/utm_campaign=featured_pick/);
 assert.notEqual(featuredBlueskyRkey('2026-10-23'),blueskyDailyRkey('2026-10-23'));
 assert.equal(featuredBlueskyRkey('2026-10-23').length,13);
 assert.equal(formatPercent(42.0),'42');
 assert.equal(formatPercent(42.2),'42.2');
 const youtube=featuredYoutubeMetadata(f);
 assert.ok(youtube.snippet.title.length<=100);
 assert.match(youtube.snippet.description,/FATES/);
 assert.equal(youtube.status.privacyStatus,'public');
});
test('minimum peers is 30 and latest two-way still valid with a real sample',()=>{
 assert.equal(MIN_FEATURED_PEERS,30);
 const selected=selectFeaturedPick([latest2],{day:'2026-10-23'});
 assert.equal(selected.tier,2);
 assert.equal(selected.players,145);
});
