import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectFeaturedPick,featureCopies,featuredBlueskyRkey,MIN_FEATURED_PEERS,
 previousPacificDay} from '../scripts/featured-pick.mjs';
import {debateCopies,debateObservation,debateFacets,debateLink,debateQuestionRkey,
 debateRevealRkey,isDebateSourceDay,assertDebatable,graphemes,YOUTUBE_PROFILE_LINK,
 DEBATE_TEMPLATE_VERSION} from '../scripts/featured-debate.mjs';
import {blueskyDailyRkey} from '../scripts/post-daily-social.mjs';
import {publishPost} from '../scripts/bluesky-records.mjs';
import {publishDebateQuestion,verifyFeaturedArtifacts,featuredYoutubeMetadata,
 FEATURED_YOUTUBE_RECEIPT} from '../scripts/publish-featured-pick.mjs';
import {revealOne,revealSourceDays,cachedFeature,publishReveals} from '../scripts/publish-debate-reveal.mjs';
import {debateScenes,questionImage} from '../scripts/render-featured-pick.mjs';
import {FEATURED_AUDIO_SECONDS,FEATURED_AUDIO_VERSION,FEATURED_AUDIO_CUE_TIMES} from '../scripts/featured-soundtrack.mjs';
import {createFormatMarkers,FORMAT_MARKERS} from '../scripts/daily-social-ledger.mjs';
import {postDaily} from '../scripts/post-daily-social.mjs';
import {genericShortRetired} from '../scripts/upload-daily-short.mjs';

const img=id=>'https://cards.scryfall.io/normal/front/a/b/'+id+'.jpg';
function row(votes,trophy,{pick=4,environment='latest',set_id='fra',prior=pick-1,type={}}={}) {
 const cards=votes.map(([id])=>({id,name:id.toUpperCase(),image_url:img(id),
  type_line:type[id]||'Creature',model_probability:0.3}));
 return {environment,puzzle_id:'p-'+trophy,round:pick,pick_number:pick,set_id,
  payload:{historical_pick_id:trophy,candidates:cards,
   prior_picks:Array.from({length:prior},(_,i)=>({name:'Prior '+i,image_url:img('prior-'+i)}))},
  votes:Object.fromEntries(votes)};
}
const day='2026-10-25'; // a Sunday Daily, published Monday: a debate day
const three=selectFeaturedPick([row([['mind',57],['inferno',46],['fates',21],['x',9],['y',2]],'fates')],{day});

test('stricter evidence: 50 players, complete prior picks, no basic-land trophy',()=>{
 assert.equal(MIN_FEATURED_PEERS,50);
 assert.equal(selectFeaturedPick([row([['a',20],['b',15],['c',10]],'a')],{day}),null);
 assert.equal(selectFeaturedPick([row([['a',40],['b',35],['c',25]],'a',{prior:2})],{day}),null,
  'a missing prior pick would misrepresent the decision');
 assert.equal(selectFeaturedPick([row([['a',40],['plains',35],['c',25]],'plains',
  {type:{plains:'Basic Land — Plains'}})],{day}),null);
 assert.equal(selectFeaturedPick([row([['a',40],['b',35],['c',25]],'a',{pick:1})],{day}).prior_picks.length,0);
 assert.equal(three.tier,3);
 assert.equal(three.prior_picks.length,3);
});

test('the question never reveals results; the reveal always does',()=>{
 const copy=debateCopies(three);
 for(const text of [copy.question,copy.questionAlt]) {
  assert.doesNotMatch(text,/%|took|trophy drafter|most popular|least popular/i);
  for(const c of three.choices)assert.match(text,new RegExp(c.name));
 }
 assert.match(copy.question,/Prior 0, Prior 1, Prior 2/);
 assert.match(copy.question,/135 Pack One players split 3 ways/);
 assert.ok(graphemes(copy.question)<=300&&graphemes(copy.reveal)<=300);
 for(const c of three.choices)assert.match(copy.reveal,new RegExp(c.pct+'% '+c.name));
 assert.match(copy.reveal,/8\.1% other cards/);
 assert.match(copy.reveal,/The trophy drafter took FATES, the least popular of the three\./);
 assert.match(copy.reveal,/packone\.pro$/);
 assert.doesNotMatch(copy.reveal+copy.question,/correct|right answer|best pick|mistake/i);
});

test('observations are factual and cover every trophy position',()=>{
 const top=selectFeaturedPick([row([['a',45],['b',43],['c',20]],'a')],{day});
 assert.equal(debateObservation(top).sentence,
  'The trophy drafter took A, the most popular choice. Only 1.9 points separated the top two.');
 const middle=selectFeaturedPick([row([['a',50],['b',35],['c',25]],'b')],{day});
 assert.equal(debateObservation(middle).sentence,'The trophy drafter took B, the second most popular choice.');
 const two=selectFeaturedPick([row([['a',73],['b',62],['c',3]],'b')],{day});
 assert.equal(two.tier,2);
 assert.match(debateObservation(two).sentence,/least popular of the two/);
});

test('long card names fall back to shorter questions, never past the 300 limit',()=>{
 const long=n=>n+' of the Exceedingly Verbose and Unnecessarily Long Card Title';
 const f=structuredClone(three);
 f.choices=f.choices.map(c=>({...c,name:long(c.name)}));
 f.trophy={...f.trophy,name:long(f.trophy.name)};
 f.prior_picks=f.prior_picks.map(c=>({...c,name:long(c.name)}));
 const copy=debateCopies(f);
 assert.ok(graphemes(copy.question)<=300);
 assert.match(copy.question,/The choices and prior picks are in the image\.\n\nA, B or C\?/);
 assert.ok(graphemes(copy.reveal)<=300);
});

test('a debate must show the trophy among its choices with the full context',()=>{
 assert.throws(()=>assertDebatable({...three,trophy:{...three.trophy,id:'fourth'}}),/trophy/);
 assert.throws(()=>assertDebatable({...three,prior_picks:three.prior_picks.slice(1)}),/context/);
 assert.throws(()=>debateCopies({...three,choices:three.choices.slice(0,2)}),/trophy/);
});

test('hashtags and the link are real Bluesky facets at exact UTF-8 offsets',()=>{
 const text='Café pick? #MTG #MTGDraft\n\nFresh Dailies every day: packone.pro';
 const facets=debateFacets(text,{url:debateLink('bluesky')});
 const buf=Buffer.from(text,'utf8');
 const slice=f=>buf.subarray(f.index.byteStart,f.index.byteEnd).toString('utf8');
 assert.deepEqual(facets.map(slice),['#MTG','#MTGDraft','packone.pro']);
 assert.deepEqual(facets.map(f=>f.features[0].tag||f.features[0].uri),
  ['MTG','MTGDraft','https://packone.pro/?utm_source=bluesky&utm_medium=social&utm_campaign=draft_debate']);
 assert.throws(()=>debateFacets('no link here',{url:debateLink('bluesky')}),/link text/);
});

test('cold visitors land on the homepage with distinct, tracked campaigns',()=>{
 assert.equal(new URL(debateLink('bluesky')).pathname,'/');
 assert.equal(new URL(debateLink('youtube')).searchParams.get('utm_campaign'),'organic_shorts');
 assert.equal(new URL(debateLink('bluesky')).searchParams.has('game'),false);
 const registry=JSON.parse(readFileSync('campaign-links.json','utf8'));
 const shorts=registry.find(e=>'https://packone.pro/go/'+e.slug+'/'===YOUTUBE_PROFILE_LINK);
 assert.deepEqual({destination:shorts.destination,source:shorts.source,campaign:shorts.campaign},
  {destination:'/',source:'youtube',campaign:'organic_shorts'});
 assert.notEqual(shorts.campaign,registry.find(e=>e.slug==='youtube').campaign,
  'organic Shorts stay separate from the earlier paid YouTube test');
 const page=readFileSync('go/shorts/index.html','utf8');
 assert.match(page,/utm_source=youtube&utm_campaign=organic_shorts&utm_medium=social/);
});

test('record keys are deterministic, valid and distinct from every other post',()=>{
 const keys=[blueskyDailyRkey(day),featuredBlueskyRkey(day),debateQuestionRkey(day),debateRevealRkey(day)];
 assert.equal(new Set(keys).size,4);
 for(const k of keys)assert.match(k,/^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/);
 assert.equal(debateQuestionRkey(day),debateQuestionRkey(day));
 assert.notEqual(debateQuestionRkey(day),debateQuestionRkey('2026-10-26'));
});

test('debates publish Monday, Wednesday and Friday only, across month and year ends',()=>{
 // Source day is the Daily shown; publication is the next morning.
 assert.deepEqual(['2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31']
  .map(isDebateSourceDay),[true,false,true,false,true,false,false]);
 assert.equal(isDebateSourceDay('2026-12-31'),true,'published Friday, January 1 2027');
 assert.equal(isDebateSourceDay('2027-01-01'),false,'published Saturday');
});

test('the Short shows cards first, results only after 9 seconds, and the brief CTA',()=>{
 const scenes=debateScenes(three,'data:image/svg+xml;base64,AA==');
 assert.equal(scenes.reduce((n,s)=>n+s.seconds,0),FEATURED_AUDIO_SECONDS);
 const starts=scenes.map((_,i)=>scenes.slice(0,i).reduce((n,s)=>n+s.seconds,0));
 assert.deepEqual(starts,[0,3,6,7,8,9,13,15]);
 assert.deepEqual(FEATURED_AUDIO_CUE_TIMES,starts.slice(1),'music cues land on scene changes');
 for(const c of three.choices)assert.match(scenes[0].body,new RegExp(c.name));
 assert.match(scenes[0].body,/135 players split 3 ways/);
 scenes.forEach((s,i)=>{
  const spoils=/%|trophy drafter took|class="card win"/i.test(s.body);
  assert.equal(spoils,starts[i]>=9&&starts[i]<15,'scene at '+starts[i]+'s');
 });
 assert.match(scenes[5].body,/42\.2%/);
 assert.match(scenes[6].body,/class="card win"><img src="[^"]+fates/);
 assert.match(scenes[1].body,/ALREADY DRAFTED/);
 for(const p of three.prior_picks)assert.match(scenes[1].body,new RegExp(p.image_url));
 assert.match(scenes[7].body,/Eight real trophy-draft decisions every day/);
 assert.match(scenes[7].body,/Free\. No account required\./);
 assert.match(scenes[7].body,/PACKONE\.PRO/);
 assert.match(scenes[7].body,/Link in profile/);
 // Real-card provenance: every image is a verified Scryfall card or the bundled logo.
 for(const html of [...scenes.map(s=>s.body),questionImage(three,'data:image/svg+xml;base64,AA==')])
  for(const [,src] of html.matchAll(/<img src="([^"]+)"/g))
   assert.ok(src.startsWith('https://cards.scryfall.io/')||src.startsWith('data:image/svg+xml;base64,'),src);
 assert.doesNotMatch(questionImage(three,'x'),/%|took|card win/i);
});

const render={day,puzzle_id:three.puzzle_id,template_version:DEBATE_TEMPLATE_VERSION,real_card_art:true,
 duration_seconds:FEATURED_AUDIO_SECONDS,audio_track:true,audio_source:FEATURED_AUDIO_VERSION,
 audio_stats:{original_composition:true},question_image:{shows_results:false}};
const today='2026-10-26';
test('the publisher only accepts yesterday\'s verified render, never the current Daily',()=>{
 const data={feature:three,copy:featureCopies(three)};
 assert.deepEqual(verifyFeaturedArtifacts(data,render,{today}),{debate:true});
 assert.throws(()=>verifyFeaturedArtifacts(data,render,{today:day}),/provenance/,
  'a feature from today\'s still-open Daily is refused');
 for(const bad of [{template_version:'old'},{question_image:{shows_results:true}},
  {audio_source:'packone-original-synth-v1'},{real_card_art:false}])
  assert.throws(()=>verifyFeaturedArtifacts(data,{...render,...bad},{today}),/provenance/);
 const meta=featuredYoutubeMetadata(three);
 assert.ok(meta.snippet.title.length<=100);
 assert.doesNotMatch(meta.snippet.title+meta.snippet.description,/%|took/,
  'title and description leave the answer to the video');
 assert.match(meta.snippet.description,/No account required/);
 assert.match(meta.snippet.description,/Fan Content/);
 assert.equal(FEATURED_YOUTUBE_RECEIPT,'featured:youtube:public:v1',
  'same receipt as the earlier featured format: one upload per source day');
});

// In-memory Bluesky PDS for idempotency tests.
function pds({records={},failCreate=null}={}) {
 const calls=[];
 const fetcher=async(url,options={})=>{
  const u=new URL(url),method=u.pathname.split('/').pop();
  calls.push(method);
  const json=(body,status=200)=>({ok:status<300,status,json:async()=>body});
  if(method==='com.atproto.server.createSession')return json({accessJwt:'jwt',did:'did:plc:test'});
  if(method==='com.atproto.repo.getRecord') {
   const r=records[u.searchParams.get('rkey')];
   return r?json({uri:'at://did:plc:test/app.bsky.feed.post/'+u.searchParams.get('rkey'),cid:'cid-'+u.searchParams.get('rkey'),value:r}):
    json({error:'RecordNotFound'},400);
  }
  if(method==='com.atproto.repo.uploadBlob')return json({blob:{ref:'blob'}});
  if(method==='com.atproto.repo.createRecord') {
   const body=JSON.parse(options.body);
   if(failCreate){const status=failCreate;failCreate=null;records[body.rkey]=body.record;return json({},status);}
   records[body.rkey]=body.record;
   return json({uri:'at://did:plc:test/app.bsky.feed.post/'+body.rkey,cid:'cid-'+body.rkey});
  }
  throw Error('unexpected '+method);
 };
 return {fetcher,calls,records};
}
const session={did:'did:plc:test',jwt:'jwt'};

test('a record key publishes once; retries, races and impostors are handled',async()=>{
 const store=pds();
 const first=await publishPost(store.fetcher,session,{rkey:'k',record:{text:'hello'}});
 assert.equal(first.status,'posted');
 const again=await publishPost(store.fetcher,session,{rkey:'k',record:{text:'hello'},
  prepare:async()=>{throw Error('must not upload again');}});
 assert.equal(again.status,'already-posted');
 await assert.rejects(publishPost(store.fetcher,session,{rkey:'k',record:{text:'different'}}),/occupied/);
 const raced=pds({failCreate:400});
 assert.equal((await publishPost(raced.fetcher,session,{rkey:'r',record:{text:'x'}})).status,'already-posted');
});

test('the question skips a day the earlier featured format already covered',async()=>{
 const legacy=pds({records:{[featuredBlueskyRkey(day)]:{text:'old featured post'}}});
 const result=await publishDebateQuestion(legacy.fetcher,{handle:'h',password:'p',f:three,image:new Uint8Array([1])});
 assert.equal(result.status,'skipped');
 assert.ok(!legacy.calls.includes('com.atproto.repo.createRecord'));
 const fresh=pds();
 const posted=await publishDebateQuestion(fresh.fetcher,{handle:'h',password:'p',f:three,image:new Uint8Array([1])});
 assert.equal(posted.status,'posted');
 const record=fresh.records[debateQuestionRkey(day)];
 assert.equal(record.text,debateCopies(three).question);
 assert.equal(record.embed.images[0].alt,debateCopies(three).questionAlt);
 assert.deepEqual(record.embed.images[0].aspectRatio,{width:1200,height:1500});
 assert.equal(record.facets.filter(f=>f.features[0].$type==='app.bsky.richtext.facet#tag').length,2);
});

test('the reveal waits four hours, threads under its own question, and posts once',async()=>{
 const asked='2026-10-26T14:12:00.000Z';
 const question={text:debateCopies(three).question,createdAt:asked};
 const store=pds({records:{[debateQuestionRkey(day)]:question}});
 const early=await revealOne(store.fetcher,session,three,{now:new Date('2026-10-26T17:00:00Z')});
 assert.equal(early.status,'skipped');
 const later=new Date('2026-10-26T20:30:00Z');
 const done=await revealOne(store.fetcher,session,three,{now:later});
 assert.equal(done.status,'posted');
 const reply=store.records[debateRevealRkey(day)];
 assert.equal(reply.text,debateCopies(three).reveal);
 assert.deepEqual(reply.reply.root,{uri:'at://did:plc:test/app.bsky.feed.post/'+debateQuestionRkey(day),
  cid:'cid-'+debateQuestionRkey(day)});
 assert.equal(reply.facets.at(-1).features[0].uri,debateLink('bluesky'));
 assert.equal((await revealOne(store.fetcher,session,three,{now:later})).status,'already-posted');
 const none=await revealOne(pds().fetcher,session,three,{now:later});
 assert.equal(none.status,'skipped');
 const mismatch=pds({records:{[debateQuestionRkey(day)]:{...question,text:'another decision'}}});
 await assert.rejects(revealOne(mismatch.fetcher,session,three,{now:later}),/does not match/);
});

test('reveals only consider yesterday and the day before, and only debate days',()=>{
 assert.deepEqual(revealSourceDays(new Date('2026-10-26T21:00:00Z')),['2026-10-25']);
 assert.deepEqual(revealSourceDays(new Date('2026-10-27T21:00:00Z')),['2026-10-25']);
 assert.deepEqual(revealSourceDays(new Date('2026-10-28T21:00:00Z')),['2026-10-27']);
 assert.deepEqual(revealSourceDays(new Date('2026-10-31T21:00:00Z')),['2026-10-29']);
 assert.equal(previousPacificDay(new Date('2026-10-26T21:00:00Z')),'2026-10-25');
});

test('a cached decision must match its day and its own generated copy',async()=>{
 const good=JSON.stringify({feature:three,copy:featureCopies(three)});
 assert.equal((await cachedFeature(day,{read:async()=>good})).puzzle_id,three.puzzle_id);
 assert.equal(await cachedFeature(day,{read:async()=>{throw Error('missing');}}),null);
 const tampered=JSON.stringify({feature:{...three,players:999},copy:featureCopies(three)});
 await assert.rejects(cachedFeature(day,{read:async()=>tampered}),/provenance/);
 await assert.rejects(cachedFeature('2026-10-24',{read:async()=>good}),/provenance/);
 assert.deepEqual(await publishReveals({env:{GITHUB_EVENT_NAME:'workflow_dispatch'},
  now:new Date('2026-10-26T21:00:00Z')}),{dry_run:true,days:['2026-10-25']});
});

function issueComments(initial=[]) {
 const comments=[...initial];
 const fetcher=async(url,options={})=>{
  if((options.method||'GET')==='GET')return {ok:true,status:200,json:async()=>comments};
  comments.push({user:{login:'github-actions[bot]'},body:JSON.parse(options.body).body});
  return {ok:true,status:201,json:async()=>({id:comments.length})};
 };
 return {fetcher,comments};
}
test('format markers are written once and only trusted from the workflow identity',async()=>{
 const forged=issueComments([{user:{login:'someone'},body:'packone-format-verified:bluesky-debate-v1\n'}]);
 const markers=createFormatMarkers({token:'t',repo:'killjoy00/mtg-ev-analyzer',fetchImpl:forged.fetcher});
 assert.equal(await markers.has(FORMAT_MARKERS.blueskyDebate),false);
 assert.equal(await markers.record(FORMAT_MARKERS.blueskyDebate,day),'recorded');
 assert.equal(await markers.record(FORMAT_MARKERS.blueskyDebate,day),'already-recorded');
 assert.equal(forged.comments.length,2);
 await assert.rejects(markers.has('anything'),/Unknown/);
});

test('the generic announcement and 10-second Short stop only after verification',async()=>{
 const env={GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',GITHUB_TOKEN:'t',
  GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',BLUESKY_HANDLE:'h',BLUESKY_APP_PASSWORD:'p'};
 const now=new Date('2026-10-26T14:10:00Z');
 const blueskyCalls=[];
 const fetchImpl=async url=>{blueskyCalls.push(String(url));throw Error('no network in test');};
 const retired=await postDaily({env,now,fetchImpl,markers:{has:async()=>true}});
 assert.equal(retired.bluesky_announcement_retired,true);
 assert.equal(blueskyCalls.length,0,'no Bluesky request once a debate has been answered');
 await assert.rejects(postDaily({env,now,fetchImpl,markers:{has:async()=>{throw Error('GitHub down');}}}),
  /Bluesky failed/,'an unknown state keeps the existing announcement');
 assert.equal(await genericShortRetired({token:'',fetchImpl}),false);
 const verified=issueComments([{user:{login:'github-actions[bot]'},body:'packone-format-verified:youtube-debate-v1\n'}]);
 assert.equal(await genericShortRetired({token:'t',fetchImpl:verified.fetcher}),true);
});
