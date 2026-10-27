import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectFeaturedPick,featureCopies} from '../scripts/featured-pick.mjs';
import {makeDesktopFeed,verifyDesktopFeed,writeDesktopFeed,sha256,safeDesktopFeedFailure} from '../scripts/patreon-desktop-feed.mjs';
const now=new Date('2026-10-27T17:00:00Z'),day='2026-10-26';
const cards=['one','two','three'].map(id=>({id,name:id.toUpperCase(),image_url:'https://cards.scryfall.io/normal/front/a/b/'+id+'.jpg',model_probability:.5}));
const feature=selectFeaturedPick([{environment:'latest',puzzle_id:'desktop-fixture',set_id:'spm',round:2,pick_number:2,
 payload:{historical_pick_id:'two',candidates:cards,prior_picks:cards.slice(0,1)},votes:{one:41,two:36,three:27}}],{day});
const cover=Buffer.alloc(6000,1);cover[0]=255;cover[1]=216;cover[2]=255;
const fixture={feature,copy:featureCopies(feature),render:{day,puzzle_id:feature.puzzle_id,real_card_art:true,poster_ready:true},cover,now};
const feed=makeDesktopFeed(fixture);
test('exports only deterministic public copy and image with next-day publication',()=>{
 assert.equal(feed.publication_day,'2026-10-27');assert.equal(feed.feature_day,day);
 assert.equal(feed.image_sha256,sha256(cover));assert.equal(feed.public,true);
 assert.equal(feed.image_path,'2026-10-27/featured-cover.jpg');
 assert.equal(feed.checked_at,undefined); // Only a successful official read can authorize this.
 assert.throws(()=>makeDesktopFeed({...fixture,now:new Date('2026-10-28T17:00Z')}),/stale-artifact/);
 assert.throws(()=>makeDesktopFeed({...fixture,render:{...fixture.render,real_card_art:false}}),/invalid-featured/);
});
test('read failures cannot become a safe-to-publish snapshot',async()=>{
 await assert.rejects(()=>verifyDesktopFeed(feed,{now,find:async()=>{throw Error('unavailable');}}),/unavailable/);
 const result=await verifyDesktopFeed(feed,{now,find:async()=>null});
 assert.equal(result.read_check,'ok');assert.equal(result.verified_public_url,null);
 const found=await verifyDesktopFeed(feed,{now,find:async()=>({url:'https://www.patreon.com/posts/123'})});
 assert.equal(found.verified_public_url,'https://www.patreon.com/posts/123');
});
test('new feed branch contains only explicit public files; updates are non-forced',async()=>{
 const requests=[];
 const fetchImpl=async(url,options)=>{
  const path=url.split('/mtg-ev-analyzer/')[1];const body=options.body?JSON.parse(options.body):null;
  requests.push({path,...options,body});
  const data=path==='git/ref/heads/packone-patreon-feed'?{object:{sha:'parent'}}:
   path==='git/commits/parent'?{tree:{sha:'base-tree'}}:path==='git/blobs'?{sha:'image-blob'}:
   path==='git/trees'?{sha:'new-tree'}:{sha:'new-commit'};
  return {ok:true,status:200,json:async()=>data};
 };
 await writeDesktopFeed({feed,cover,token:'test-only',fetchImpl});
 const tree=requests.find(r=>r.path==='git/trees').body;
 assert.equal(tree.base_tree,'base-tree');assert.deepEqual(tree.tree.map(t=>t.path),[feed.image_path,'latest.json','2026-10-27/post.json']);
 assert.equal(requests.at(-1).body.force,false);
 assert.ok(requests.every(r=>r.redirect==='error'));
 const bad=Buffer.from('changed');
 await assert.rejects(()=>writeDesktopFeed({feed,cover:bad,token:'test-only',fetchImpl}),/image-mismatch/);
});
test('workflow keeps cloud publishing paused and releases only main builds',()=>{
 const daily=readFileSync(new URL('../.github/workflows/daily-social-post.yml',import.meta.url),'utf8');
 assert.match(daily,/PACKONE_PATREON_AUTO_ACTIVATE: 'false'/);
 const build=readFileSync(new URL('../.github/workflows/patreon-desktop.yml',import.meta.url),'utf8');
 assert.match(build,/github\.event_name != 'pull_request'.*refs\/heads\/main/);
 assert.match(build,/runtime-self-test\.ok/);
 const workflow=readFileSync(new URL('../.github/workflows/patreon-desktop-feed.yml',import.meta.url),'utf8');
 assert.match(workflow,/run\.run_attempt!==1/);assert.match(workflow,/run\.head_repository\?\.full_name/);
});

test('public diagnostics expose only fixed failure codes, never private exception details',()=>{
 assert.equal(safeDesktopFeedFailure(Error('patreon-post-read-failed-401')),'patreon-post-read-failed-401');
 const error=Error('patreon-existing-post-not-verified-public');error.verificationReason='url-invalid';
 assert.equal(safeDesktopFeedFailure(error),'patreon-existing-post-not-verified-public:url-invalid');
 error.verificationReason='secret-fixture-account';
 assert.equal(safeDesktopFeedFailure(error),'patreon-existing-post-not-verified-public');
 assert.equal(safeDesktopFeedFailure(Error('https://private.example/?token=secret-fixture')),'unknown');
 assert.equal(safeDesktopFeedFailure(Error('Stale Daily publisher revision; dispatch a fresh run on current main.')),'revision-stale');
});

test('the existing morning dispatch delivers desktop media after artifact upload independently of other destinations',()=>{
 const daily=readFileSync(new URL('../.github/workflows/daily-social-post.yml',import.meta.url),'utf8');
 const job=daily.split('  featured-patreon-feed:')[1].split('  featured-patreon:')[0];
 assert.match(job,/needs: \[featured\]/);
 assert.match(job,/always\(\)/);
 assert.match(job,/needs\.featured\.outputs\.artifact_ready == 'true'/);
 assert.match(job,/contents: write/);
 assert.match(job,/group: packone-patreon-feed/);
 assert.match(job,/actions\/download-artifact@v4/);
 assert.match(job,/node scripts\/patreon-desktop-feed\.mjs/);
 assert.doesNotMatch(job,/BLUESKY|DISCORD|BROWSERLESS|STORAGE_STATE|NEON_API_KEY/);
});
