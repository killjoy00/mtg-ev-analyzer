import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectFeaturedPick,featureCopies} from '../scripts/featured-pick.mjs';
import {makePatreonPost,parsePatreonStorageState,findPublishedPatreonPost,
 publishFeaturedPatreon,browserlessEndpoint} from '../scripts/publish-featured-patreon.mjs';
import {filteredPatreonState,codespaceHosts,installSessionSecret,
 startMobilePatreonSetup} from '../scripts/patreon-mobile-auth-server.mjs';
import {EventEmitter} from 'node:events';

const d='2026-10-24';
const cards=['one','two','three'].map(id=>({id,name:id.toUpperCase(),
 image_url:'https://cards.scryfall.io/normal/front/a/b/'+id+'.jpg',
 model_probability:.5}));
const feature=selectFeaturedPick([{environment:'latest',puzzle_id:'featured-fixture',
 set_id:'spm',round:2,pick_number:2,payload:{historical_pick_id:'two',
  candidates:cards,prior_picks:cards.slice(0,1)},
 votes:{one:41,two:36,three:27}}],{day:d});
assert.ok(feature);
const copy=featureCopies(feature);
const cover=Buffer.alloc(6000,1);
cover[0]=0xff;cover[1]=0xd8;cover[2]=0xff;
const render={day:d,puzzle_id:feature.puzzle_id,real_card_art:true,poster_ready:true};
const fixture={feature,copy,render,cover};
const expected=makePatreonPost(fixture);
const validSession=Buffer.from(JSON.stringify({cookies:[{domain:'.patreon.com',
 name:'session_id',value:'fixture',path:'/'}],origins:[]})).toString('base64');
const env={PACKONE_PATREON_AUTOPUBLISH_ENABLED:'true',
 PACKONE_PATREON_STORAGE_STATE_B64:validSession,
 PATREON_CREATOR_ACCESS_TOKEN:'fixture-oauth-token',
 GITHUB_TOKEN:'fixture-github-token',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',
 GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule',
 GITHUB_RUN_ATTEMPT:'1'};
const artifacts=async(path)=>path.endsWith('pick.json')?JSON.stringify({feature,copy}):
 path.endsWith('render.json')?JSON.stringify(render):cover;
const fakeLedger=records=>()=>({
 claim:async(day,key)=>{records.push(['claim',day,key]);return {id:5};},
 markPosted:async(day,key)=>records.push(['posted',day,key]),
 markFailed:async(day,key)=>records.push(['failed',day,key]),
});
const preflight=async()=>({checked:true});

test('formats a real public image post, with a date-unique title and readable text',()=>{
 assert.match(expected.title,/Pack One Daily 2026-10-24$/);
 assert.match(expected.body,/ONE/);
 assert.match(expected.body,/2026-10-24/);
 assert.ok(expected.body.includes('TWO'));
 assert.ok(!expected.body.includes('**'));
 assert.equal(expected.public,true);
});

test('rejects stale, off-choice, fake art or mismatched content without opening Patreon',()=>{
 assert.throws(()=>makePatreonPost({...fixture,render:{...render,real_card_art:false}}),
  /invalid-featured-artifact/);
 assert.throws(()=>makePatreonPost({...fixture,cover:Buffer.from('not-jpeg')}),
  /invalid-featured-artifact/);
 assert.throws(()=>makePatreonPost({...fixture,copy:{...copy,title:'fake'}}),
  /invalid-featured-artifact/);
 assert.throws(()=>makePatreonPost({...fixture,feature:{...feature,
  trophy:{...feature.trophy,id:'fourth'}}}),/invalid-featured-artifact/);
});

test('accepts encrypted-secret-compatible storageState JSON, not an invalid session',()=>{
 assert.deepEqual(parsePatreonStorageState(validSession).origins,[]);
 assert.throws(()=>parsePatreonStorageState('bad'),/session-missing/);
 const wrong=Buffer.from(JSON.stringify({cookies:[{domain:'.evil.org',value:'x'}],
  origins:[]})).toString('base64');
 assert.throws(()=>parsePatreonStorageState(wrong),/session-missing/);
});

function response(payload,status=200) {
 return {ok:status===200,status,json:async()=>payload};
}
const item=(title,is_public=true)=>({id:'890',attributes:{title,is_public,
 published_at:'2026-10-25T14:18:00Z',url:'https://www.patreon.com/posts/890'}});
test('supported read-only Patreon API verifies the exact public title across pages',async()=>{
 let calls=0;
 const found=await findPublishedPatreonPost({title:expected.title,token:'safe',fetchImpl:async(url,options)=>{
  calls++;
  assert.equal(options.redirect,'error');
  assert.ok(url.startsWith('https://www.patreon.com/api/oauth2/v2/campaigns/'));
  assert.ok(options.headers.authorization.startsWith('Bearer '));
  assert.equal(options.headers['user-agent'],'Pack One featured publisher');
  if(calls===1)return response({data:[item('Different title')],
   meta:{pagination:{cursors:{next:'cursor-2'}}}});
  assert.match(url,/page%5Bcursor%5D=cursor-2/);
  return response({data:[item(expected.title)]});
 }});
 assert.equal(calls,2);
 assert.equal(found.id,'890');
 assert.equal(found.url,'https://www.patreon.com/posts/890');
});
test('publishing verification fails closed on API error, private post, or unsafe redirect',async()=>{
 await assert.rejects(findPublishedPatreonPost({title:expected.title,token:'safe',
  fetchImpl:async()=>response({},401)}),/read-failed-401/);
 await assert.rejects(findPublishedPatreonPost({title:expected.title,token:'safe',
  fetchImpl:async()=>response({data:[item(expected.title,false)]})}),
  /not-verified-public/);
 await assert.rejects(findPublishedPatreonPost({title:expected.title,token:'safe',
  fetchImpl:async()=>response({data:[],links:{next:'https://evil.test/steal'}})}),
  /search-incomplete/);
 await assert.rejects(findPublishedPatreonPost({title:expected.title,token:'safe',
  fetchImpl:async()=>response({data:[item(expected.title),item(expected.title)]})}),
  /duplicate-posts/);
});

test('unconfigured publisher is inert and requires explicit activation',async()=>{
 const result=await publishFeaturedPatreon({env:{},read:async()=>{
  assert.fail('must not inspect production files when disabled');
 }});
 assert.equal(result.reason,'patreon-autopublish-not-activated');
});

test('publishes once, confirms API result and records a durable receipt',async()=>{
 const records=[];let requests=0,opened=0;
 const out=await publishFeaturedPatreon({env,read:artifacts,
  now:new Date('2026-10-25T17:00:00Z'),assertLive:preflight,
  ledgerFactory:fakeLedger(records),
  findPost:async()=>++requests===1?null:{id:'890',url:'https://www.patreon.com/posts/890'},
  editor:async({post,state,onSubmit})=>{
   opened++;assert.equal(post.title,expected.title);
   assert.ok(state.cookies.length>0);onSubmit();
  },sleep:async()=>{},verifyPublic:async({url,post})=>{
   assert.equal(url,'https://www.patreon.com/posts/890');
   assert.equal(post.title,expected.title);
  }});
 assert.equal(out.published,true);
 assert.equal(opened,1);
 assert.deepEqual(records.map(r=>r[0]),['claim','posted']);
});

test('existing public post is skipped before claiming or launching browser',async()=>{
 const r=await publishFeaturedPatreon({env,read:artifacts,
  now:new Date('2026-10-25T17:00:00Z'),assertLive:preflight,
  findPost:async()=>({id:'890',url:'https://www.patreon.com/posts/890'}),
  verifyPublic:async()=>true,
  ledgerFactory:()=>{assert.fail('no claim when already live');},
  editor:async()=>{assert.fail('no browser when already live');}});
 assert.equal(r.alreadyPosted,true);
});

test('an unverified public body/image cannot produce a posted receipt or hide an ambiguous submission',async()=>{
 const records=[];let reads=0;
 await assert.rejects(publishFeaturedPatreon({env,read:artifacts,
  now:new Date('2026-10-25T17:00:00Z'),assertLive:preflight,
  ledgerFactory:fakeLedger(records),
  findPost:async()=>++reads===1?null:{id:'890',url:'https://www.patreon.com/posts/890'},
  editor:async({onSubmit})=>onSubmit(),
  verifyPublic:async()=>{throw Error('patreon-public-verification-failed');}}),/publication-ambiguous/);
 assert.deepEqual(records.map(r=>r[0]),['claim']);
});

test('safe UI error marks retryable; a possible Publish leaves claimed receipt',async()=>{
 for(const submit of [false,true]) {
  const records=[];
  await assert.rejects(publishFeaturedPatreon({env,read:artifacts,
   now:new Date('2026-10-25T17:00:00Z'),assertLive:preflight,
   ledgerFactory:fakeLedger(records),findPost:async()=>null,
   editor:async({onSubmit})=>{if(submit)onSubmit();throw Error('browser failed');}}),
   submit?/publication-ambiguous/:/before-publish/);
  assert.deepEqual(records.map(r=>r[0]),submit?['claim']:['claim','failed']);
 }
});

test('stale selection and stale Neon source date cannot publish',async()=>{
 const stale=await publishFeaturedPatreon({env:{...env,SOURCE_PACIFIC_DAY:'2026-10-23'},
  now:new Date('2026-10-25T17:00:00Z'),read:artifacts,assertLive:preflight});
 assert.equal(stale.reason,'stale-pacific-dispatch');
 await assert.rejects(publishFeaturedPatreon({env,read:artifacts,
  now:new Date('2026-10-27T17:00:00Z'),assertLive:preflight}),
  /day-stale/);
});

test('production workflow isolates Patreon from other channels and keeps secrets out of artifacts',()=>{
 const source=readFileSync(new URL('../.github/workflows/daily-social-post.yml',import.meta.url),'utf8');
 assert.match(source,/featured-patreon:/);
 assert.match(source,/PACKONE_PATREON_STORAGE_STATE_B64: \$\{\{ secrets\.PACKONE_PATREON_STORAGE_STATE_B64 \}\}/);
 assert.match(source,/PACKONE_PATREON_AUTOPUBLISH_ENABLED: 'false'/);
 assert.match(source,/needs: \[featured\]/);
 assert.match(source,/scripts\/publish-featured-patreon\.mjs/);
 assert.match(source,/tests\/featured-patreon\.test\.mjs/);
 const config=JSON.parse(readFileSync(new URL('../.devcontainer/patreon-auth/devcontainer.json',import.meta.url),'utf8'));
 assert.deepEqual(config.forwardPorts,[6081,6080]);
 assert.match(config.postStartCommand,/patreon-mobile-auth-server\.mjs/);
 assert.ok(!JSON.stringify(config).includes('public'));
 const cloud=readFileSync(new URL('../scripts/patreon-mobile-auth-server.mjs',import.meta.url),'utf8');
 assert.match(cloud,/GH_TOKEN/);
 assert.match(cloud,/filteredPatreonState/);
 assert.match(cloud,/\-rfbauth/);
 assert.doesNotMatch(cloud,/-nopw/);
});

test('mobile Codespaces helper limits captured state to Patreon-origin credentials',()=>{
 const valid={cookies:[
  {domain:'.patreon.com',name:'login',value:'private-session',path:'/'},
  {domain:'unrelated.test',name:'other',value:'not-allowed',path:'/'},
 ],origins:[
  {origin:'https://www.patreon.com',localStorage:[{name:'p',value:'1'}]},
  {origin:'https://other.test',localStorage:[{name:'bad',value:'2'}]},
 ]};
 const encoded=filteredPatreonState(valid);
 const decoded=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 assert.equal(decoded.cookies.length,1);
 assert.equal(decoded.origins.length,1);
 assert.equal(decoded.cookies[0].domain,'.patreon.com');
 assert.throws(()=>filteredPatreonState({cookies:[],origins:[]}),/sign-in-not-confirmed/);
 assert.throws(()=>filteredPatreonState({cookies:[valid.cookies[1]],origins:[]}),/sign-in-not-confirmed/);
});
test('private Codespace URLs are validated before building a login link',()=>{
 const links=codespaceHosts('friendly-codespace-123');
 assert.match(links.login,/^https:\/\/friendly-codespace-123-6080\.app\.github\.dev\/vnc\.html/);
 assert.equal(links.setup,'friendly-codespace-123-6081.app.github.dev');
 assert.throws(()=>codespaceHosts('evil.com/path'),/codespace-name-unavailable/);
});
test('session secret goes to GitHub CLI stdin, never command arguments or stdout',async()=>{
 let injected='';
 const spawned=[];
 const spawnImpl=(cmd,args,options)=>{
  spawned.push({cmd,args,options});
  const child=new EventEmitter();
  child.stdin=new EventEmitter();
  child.stdin.end=value=>{
   injected=value;
   queueMicrotask(()=>child.emit('exit',0));
  };
  return child;
 };
 const ok=await installSessionSecret('fixture-secret',{token:'codespace-token',spawnImpl});
 assert.equal(ok,true);
 assert.match(injected,/fixture-secret/);
 assert.ok(!JSON.stringify(spawned[0].args).includes('fixture-secret'));
 assert.equal(spawned[0].options.env.GH_TOKEN,'codespace-token');
 assert.deepEqual(spawned[0].options.stdio,['pipe','ignore','ignore']);
});
test('mobile login helper cannot run outside an authenticated Codespace',async()=>{
 await assert.rejects(startMobilePatreonSetup({
  name:'friendly-codespace-123',codespaces:'false'}),/cloud-browser-only/);
});

test('Browserless endpoint accepts only token characters and never uses HTTP',()=>{
 assert.equal(browserlessEndpoint('abcdefghijklmnop'),
  'wss://production-sfo.browserless.io?token=abcdefghijklmnop');
 assert.throws(()=>browserlessEndpoint('https://evil.example/?token=secret'));
 assert.throws(()=>browserlessEndpoint(''));
});
