import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkPatreonPublishing} from '../scripts/check-patreon-publishing.mjs';
import {openPatreonBrowser,browserlessEndpoint,assertPatreonCreator,
 publishFeaturedPatreon} from '../scripts/publish-featured-patreon.mjs';
import {PATREON_POLICY} from '../patreon-policy.mjs';

const env={PACKONE_BROWSERLESS_TOKEN:'fixture-browserless-token',
 PATREON_CREATOR_ACCESS_TOKEN:'fixture-read-token',GITHUB_TOKEN:'fixture-github-token'};
const response=(data,status=200)=>({ok:status===200,status,json:async()=>data});

test('saved login is reused in the default context; a fresh context would lose it',async()=>{
 let connected,closed=false;
 const page={setDefaultTimeout(){}};
 const defaultContext={newPage:async()=>page};
 const browser={contexts:()=>[defaultContext],newContext:()=>assert.fail('profile lost'),
  close:async()=>{closed=true;}};
 const result=await openPatreonBrowser({browserlessToken:env.PACKONE_BROWSERLESS_TOKEN,
  profile:'packone-patreon',chromiumImpl:{connectOverCDP:async endpoint=>{
   connected=endpoint;return browser;
  }}});
 assert.equal(result.context,defaultContext);
 assert.equal(result.page,page);
 assert.equal(closed,false);
 assert.match(connected,/&profile=packone-patreon&timeout=120000$/);
 await browser.close();
});

test('profile failure closes remote browser and never silently opens an unauthenticated context',async()=>{
 let closed=0;
 await assert.rejects(openPatreonBrowser({profile:'packone-patreon',
  browserlessToken:env.PACKONE_BROWSERLESS_TOKEN,chromiumImpl:{connectOverCDP:async()=>({
   contexts:()=>[],close:async()=>{closed++;},
   newContext:()=>assert.fail('must not fall back'),
  })}}),/profile-context-unavailable/);
 assert.equal(closed,1);
 assert.throws(()=>browserlessEndpoint(env.PACKONE_BROWSERLESS_TOKEN,'../other'));
});

test('legacy and anonymous browsing get fresh contexts, never the saved profile',async()=>{
 for(const state of [undefined,{cookies:[],origins:[]}]) {
  let options;
  await openPatreonBrowser({state,browserlessToken:env.PACKONE_BROWSERLESS_TOKEN,
   chromiumImpl:{connectOverCDP:async endpoint=>{
    assert.doesNotMatch(endpoint,/profile=/);
    return {contexts:()=>assert.fail('must isolate anonymous state'),
     newContext:async opts=>{options=opts;return {newPage:async()=>({setDefaultTimeout(){}})};}};
   }}});
  assert.equal(options.storageState,state);
 }
});

test('creator navigation must identify Pack One before any editor action',async()=>{
 for(const [href,ok] of [['/c/PackOne',true],['/PackOne/',true],
  ['/c/OtherCreator',false],['https://evil.test/c/PackOne',false]]) {
  const page={goto:async()=>{},url:()=> 'https://www.patreon.com/home',
   getByRole:(role,opts)=>{
    assert.equal(role,'link');assert.match('My page',opts.name);
    return {count:async()=>1,isVisible:async()=>true,getAttribute:async()=>href};
   }};
  if(ok)await assertPatreonCreator(page);
  else await assert.rejects(assertPatreonCreator(page),/creator-mismatch/);
 }
 await assert.rejects(assertPatreonCreator({goto:async()=>{},
  url:()=> 'https://notpatreon.com/'}),/login-required/);
});

test('readiness verifies the existing secret, saved profile, API scopes and browser identity',async()=>{
 let closed=0,opened=0,verified=0;
 const out=await checkPatreonPublishing({env,fetchImpl:async url=>{
  if(url.includes('browserless.io/profile/'))return response({name:'packone-patreon',cookieCount:3});
  if(url.endsWith('/campaigns'))return response({data:[{id:PATREON_POLICY.campaignId}]});
  return response({data:[]});
 },openBrowser:async args=>{
  opened++;assert.equal(args.profile,'packone-patreon');
  return {browser:{close:async()=>{closed++;}},page:{}};
 },assertCreator:async()=>{verified++;}});
 assert.deepEqual(out,{ready:true});
 assert.equal(opened,1);assert.equal(verified,1);assert.equal(closed,1);
});

test('missing profile, wrong campaign and missing posts scope cannot pass readiness',async()=>{
 for(const scenario of ['missing-profile','wrong-campaign','missing-posts-scope']) {
  await assert.rejects(checkPatreonPublishing({env,fetchImpl:async url=>{
   if(url.includes('browserless.io/profile/'))return scenario==='missing-profile'?
    response({},404):response({name:'packone-patreon',cookieCount:1});
   if(url.endsWith('/campaigns'))return response({data:[{id:scenario==='wrong-campaign'?
    '999':PATREON_POLICY.campaignId}]});
   return response({},403);
  },openBrowser:async()=>assert.fail('must fail before browser opens')}),
  /patreon-(browser-profile-missing|read-campaign-mismatch|post-read-failed-403)/);
 }
});

test('a failed creator check still closes the browser',async()=>{
 let closed=false;
 await assert.rejects(checkPatreonPublishing({env,fetchImpl:async url=>response(
  url.includes('browserless.io')?{name:'packone-patreon',cookieCount:1}:
  {data:url.endsWith('/campaigns')?[{id:PATREON_POLICY.campaignId}]:[]}),
  openBrowser:async()=>({page:{},browser:{close:async()=>{closed=true;}}}),
  assertCreator:async()=>{throw Error('patreon-creator-mismatch');}}),/creator-mismatch/);
 assert.equal(closed,true);
});

test('automatic mornings wait for the one-time login before reading media or claiming a post',async()=>{
 const live={...env,PACKONE_PATREON_AUTO_ACTIVATE:'true',
  GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_REF:'refs/heads/main',
  GITHUB_EVENT_NAME:'schedule'};
 const result=await publishFeaturedPatreon({env:live,assertLive:async()=>{},
  connectionCheck:async()=>{throw Error('patreon-browser-profile-missing');},
  read:async()=>assert.fail('not connected'),ledgerFactory:()=>assert.fail('not connected')});
 assert.equal(result.reason,'patreon-waiting-for-one-time-sign-in');
 await assert.rejects(publishFeaturedPatreon({env:live,assertLive:async()=>{},
  connectionCheck:async()=>{throw Error('patreon-creator-mismatch');},
  read:async()=>assert.fail('wrong creator')}),/creator-mismatch/);
});

test('explicit pause wins over automatic activation; unset configuration stays inert',async()=>{
 const result=await publishFeaturedPatreon({env:{PACKONE_PATREON_AUTOPUBLISH_ENABLED:'false',
  PACKONE_PATREON_AUTO_ACTIVATE:'true'},connectionCheck:async()=>assert.fail('paused'),
  read:async()=>assert.fail('must not read media')});
 assert.equal(result.skipped,true);
});

test('live workflow keeps credentials out of artifacts and uses the morning concurrency lock',()=>{
 const source=readFileSync(new URL('../.github/workflows/patreon-publishing.yml',import.meta.url),'utf8');
 assert.match(source,/group: packone-social-live/);
 assert.match(source,/inputs\.publish_once == true/);
 assert.match(source,/Publish and independently verify Patreon/);
 assert.doesNotMatch(source,/upload-artifact|set-secret|liveURL|secrets: write/);
});
