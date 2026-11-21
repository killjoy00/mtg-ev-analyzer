import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeSettings,assertDevelopmentInvariants,client,restore,DEVELOPMENT_BRANCH,PRODUCTION_BRANCH} from '../scripts/development-auth-settings.mjs';

const webhook={enabled:false,webhook_url:'https://hook.example/webhook',enabled_events:['send.magic_link'],timeout_seconds:5};
const development={domains:['https://a.example','https://preview.example'],allowLocalhost:true,webhook};

function fakeNeon(state) {
  const calls=[];
  const fetcher=async(url,{method,body})=>{
    const path=new URL(url).pathname.split('/auth')[1];
    const data=body?JSON.parse(body):null;
    calls.push([method,path]);
    if(method==='GET'&&path==='/domains')return json({domains:state.domains.map(domain=>({domain,auth_provider:'better_auth'}))});
    if(method==='GET'&&path==='/allow_localhost')return json({allow_localhost:state.allowLocalhost});
    if(method==='GET'&&path==='/webhooks')return json(state.webhook);
    if(method==='POST'&&path==='/domains'){state.domains.push(data.domain);return json({},201);}
    if(method==='DELETE'&&path==='/domains'){state.domains=state.domains.filter(d=>!data.domains.some(x=>x.domain===d));return json({});}
    if(method==='PATCH'&&path==='/allow_localhost'){state.allowLocalhost=data.allow_localhost;return json(data);}
    if(method==='PUT'&&path==='/webhooks'){state.webhook=data;return json(data);}
    return json({},404);
  };
  return {calls,fetcher,state};
}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('normalization sorts domains and events and rejects malformed responses',()=>{
  const value=normalizeSettings({domains:[{domain:'https://b'},'https://a','https://a'],allowLocalhost:true,
    webhook:{enabled:0,webhook_url:'u',enabled_events:['y','x'],timeout_seconds:'5'}});
  assert.deepEqual(value,{domains:['https://a','https://b'],allowLocalhost:true,webhook:{enabled:false,webhook_url:'u',enabled_events:['x','y'],timeout_seconds:5}});
  assert.throws(()=>normalizeSettings({domains:[{}],allowLocalhost:true}),/trusted-domain/);
  assert.throws(()=>normalizeSettings({domains:[],allowLocalhost:'yes'}),/allow_localhost/);
});

test('a production-like development snapshot is refused',()=>{
  assert.doesNotThrow(()=>assertDevelopmentInvariants(development));
  assert.throws(()=>assertDevelopmentInvariants({...development,webhook:{...webhook,enabled:true}}),/webhook is enabled/);
  assert.throws(()=>assertDevelopmentInvariants({...development,allowLocalhost:false}),/localhost disabled/);
});

test('the script can only address the development branch',()=>{
  assert.throws(()=>client({branch:PRODUCTION_BRANCH,apiKey:'k',fetcher:fakeNeon({}).fetcher}),/Only the development branch/);
  assert.throws(()=>client({branch:DEVELOPMENT_BRANCH,apiKey:''}),/NEON_API_KEY/);
});

test('restore undoes a reset that copied production settings, then verifies',async()=>{
  const neon=fakeNeon({domains:['https://a.example','https://prod-only.example'],allowLocalhost:false,webhook:{...webhook,enabled:true}});
  const api=client({apiKey:'k',fetcher:neon.fetcher});
  const after=await restore(api,development);
  assert.deepEqual(after,normalizeSettings(development));
  assert.deepEqual(neon.state.domains.sort(),development.domains);
  assert.equal(neon.state.allowLocalhost,true);
  assert.equal(neon.state.webhook.enabled,false);
  for(const call of [['DELETE','/domains'],['POST','/domains'],['PATCH','/allow_localhost'],['PUT','/webhooks']])
    assert.ok(neon.calls.some(c=>c[0]===call[0]&&c[1]===call[1]),call.join(' '));
});

test('restore writes nothing when development already matches',async()=>{
  const neon=fakeNeon(structuredClone(development));
  await restore(client({apiKey:'k',fetcher:neon.fetcher}),development);
  assert.ok(neon.calls.every(([method])=>method==='GET'));
});

test('restore fails if Neon does not reach the requested settings',async()=>{
  const neon=fakeNeon({domains:[],allowLocalhost:false,webhook});
  const stuck=async(url,options)=>options.method==='PATCH'?json({allow_localhost:false}):neon.fetcher(url,options);
  await assert.rejects(()=>restore(client({apiKey:'k',fetcher:stuck}),{...development,domains:[]}),/did not return/);
});

test('reset workflow snapshots, resets, restores, redeploys and verifies in that order',()=>{
  const flow=fs.readFileSync('.github/workflows/reset-development.yml','utf8');
  assert.match(flow,/^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(flow,/\n  (push|pull_request|schedule):/);
  assert.match(flow,/test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(flow,/test "\$CONFIRM" = "reset development"/);
  assert.match(flow,/group: packone-corpus-mutation\n  cancel-in-progress: false/);
  assert.match(flow,/permissions:\n  contents: read\n  actions: write\n/);
  const order=['Resolve the revision production runs','Refuse a reset that would move child branches',
    'Snapshot development Auth settings','Reset development from production','Restore development Auth settings',
    "Redeploy production's revision to development",'Verify development functions and Auth settings'].map(name=>flow.indexOf('- name: '+name));
  assert.ok(order.every(i=>i>0),'every step is present');
  assert.deepEqual([...order].sort((a,b)=>a-b),order,'steps run in order');
  assert.match(flow,/neon branches reset "\$DEVELOPMENT_BRANCH" --parent/);
  assert.doesNotMatch(flow,/branches reset "\$PRODUCTION_BRANCH"/);
  assert.match(flow,/gh workflow run deploy-functions\.yml --ref main -f target=development -f commit="\$RELEASE_COMMIT"/);
  assert.match(flow,/gh run watch "\$run" --exit-status/);
  assert.match(flow,/git merge-base --is-ancestor "\$\{commits\[0\]\}" origin\/main/);
  assert.match(flow,/development-auth-settings\.mjs verify/);
});
