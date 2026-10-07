import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlRequest} from '../scripts/control-read.mjs';
import {createCiBranch} from '../scripts/create-ci-neon-branch.mjs';
import {attachPreviewDomain,detachPreviewDomain,recoverablePreviewDomain} from '../scripts/edge-control.mjs';

const sleep=async()=>{};
test('control reads retry transient failures with sanitized errors, writes do not retry blindly',async()=>{
  const calls=[];let attempts=0;
  const result=await controlRequest('https://control.invalid',{provider:'Test',token:'secret',sleep,
    fetcher:async(_url,options)=>{calls.push(options);if(++attempts===1)throw Error('secret');
      if(attempts===2)return new Response('secret',{status:500});return Response.json({ready:true});}});
  assert.deepEqual(result,{ready:true});assert.equal(calls.length,3);
  assert.ok(calls.every(c=>c.redirect==='error'&&c.signal instanceof AbortSignal));
  for(const method of ['POST','PUT','DELETE']) {
    let writes=0;
    await assert.rejects(controlRequest('https://control.invalid',{provider:'Test',token:'secret',sleep,method,
      fetcher:async()=>{writes++;return new Response('secret',{status:500});}}),/^Error: Test control HTTP 500\.$/);
    assert.equal(writes,1);
  }
  let rejected=0;
  await assert.rejects(controlRequest('https://control.invalid',{provider:'Test',token:'secret',sleep,
    fetcher:async()=>{rejected++;return new Response('secret',{status:403});}}),/^Error: Test control HTTP 403\.$/);
  assert.equal(rejected,1);
});

const now=()=>Date.parse('2026-10-07T04:00:00Z'),expires='2026-10-07T06:00:00Z',parent='br-orange-feather-ayps8kep';
const nonce='a'.repeat(32),prefix='launch-load-1234-1';
const branch={id:'br-test-owned',name:`${prefix}-${nonce}`,parent_id:parent,expires_at:expires};
const uri='postgresql://pack1_owner:password@ep-test.us-east-2.aws.neon.tech/pack1?sslmode=require';
const config={now,expires,parent,prefix,nonce,token:'secret',sleep};
test('unknown Neon create outcome reconciles its unique branch without a second POST',async()=>{
  let reads=0,posts=0,connections=0;const outputs=[];
  const result=await createCiBranch({...config,output:(...o)=>outputs.push(o),fetcher:async(url,options)=>{
    if(options.method==='POST') {
      posts++;assert.equal(JSON.parse(options.body).branch.parent_id,parent);
      assert.equal(JSON.parse(options.body).endpoints[0].suspend_timeout_seconds,300);
      throw Error('request committed but response timed out');
    }
    if(url.includes('/branches?'))return Response.json({branches:++reads===1?[]:[branch]});
    assert.ok(url.includes('branch_id=br-test-owned'));assert.ok(url.includes('database_name=pack1'));
    connections++;if(connections===1)return new Response('secret',{status:503});
    assert.deepEqual(outputs,[['branch_id',branch.id],['created','true']]);
    return Response.json({uri});
  }});
  assert.deepEqual(result,{branch_id:branch.id,created:'true'});assert.equal(posts,1);assert.equal(reads,2);
  assert.equal(connections,2);assert.deepEqual(outputs[2],['db_url',uri]);
});
test('Neon failure publishes cleanup ownership before connection reads fail',async()=>{
  const outputs=[];
  await assert.rejects(createCiBranch({...config,output:(...o)=>outputs.push(o),fetcher:async(url,options)=>{
    if(options.method==='POST')return Response.json({branch});
    if(url.includes('/branches?'))return Response.json({branches:[]});
    return new Response('secret',{status:403});
  }}),/^Error: Neon control HTTP 403\.$/);
  assert.deepEqual(outputs,[['branch_id',branch.id],['created','true']]);
});
test('Neon provisioning refuses preexisting, ambiguous and incorrectly parented branches',async()=>{
  for(const branches of [[branch],[branch,branch]]) {
    let posts=0;
    await assert.rejects(createCiBranch({...config,fetcher:async(_url,o)=>{
      if(o.method==='POST')posts++;return Response.json({branches});
    }}),/existing CI branch|ambiguous CI branch/);
    assert.equal(posts,0);
  }
  await assert.rejects(createCiBranch({...config,fetcher:async(_url,o)=>o.method==='POST'
    ?Response.json({branch:{...branch,parent_id:'br-other'}}):Response.json({branches:[]})}),/isolation and expiry/);
});
test('Neon unknown create without its branch fails closed, never creates twice',async()=>{
  let posts=0;
  await assert.rejects(createCiBranch({...config,fetcher:async(_url,o)=>{
    if(o.method==='POST'){posts++;return new Response('secret',{status:500});}
    return Response.json({branches:[]});
  }}),/outcome is unknown/);assert.equal(posts,1);
});

const zone={id:'1'.repeat(32),account:{id:'2'.repeat(32)}};
const domain={id:'owned-record',hostname:'api-preview.packone.pro',service:'pack1-gateway-preview',zone_id:zone.id};
test('Cloudflare attachment reconciles a 500 that actually installed the fixed domain',async()=>{
  let installed=false,writes=0;
  await attachPreviewDomain({sleep,readContext:async()=>({zone,domain:installed?domain:null}),request:async(route,options)=>{
    writes++;assert.ok(route.endsWith('/workers/scripts/pack1-gateway-preview/domains/records'));
    assert.deepEqual(options.body,{override_scope:false,override_existing_origin:false,override_existing_dns_record:false,
      origins:[{hostname:domain.hostname,zone_id:zone.id}]});
    installed=true;throw Object.assign(Error('Cloudflare control HTTP 500.'),{status:500});
  }});assert.equal(writes,1);
});
test('Cloudflare attachment retries an uncommitted transient failure with fresh ownership checks',async()=>{
  let installed=false,writes=0,reads=0;
  await attachPreviewDomain({sleep,readContext:async()=>{reads++;return {zone,domain:installed?domain:null};},
    request:async()=>{if(++writes===1)throw Object.assign(Error('Cloudflare control HTTP 500.'),{status:500});installed=true;}});
  assert.equal(writes,2);assert.equal(reads,4);
});
test('Cloudflare attachment stops before another write if ownership changes during reconciliation',async()=>{
  let reads=0,writes=0;
  await assert.rejects(attachPreviewDomain({sleep,readContext:async()=>{
    if(++reads>1)throw Error('Preview hostname belongs to another service');return {zone,domain:null};
  },request:async()=>{writes++;throw Object.assign(Error('failed'),{status:500});}}),/another service/);
  assert.equal(writes,1);
});
test('Cloudflare cleanup reconciles an ambiguous DELETE and never deletes a replaced attachment',async()=>{
  for(const replaced of [false,true]) {
    let reads=0,writes=0;
    const operation=()=>detachPreviewDomain({sleep,readContext:async()=>({zone,domain:++reads===1?domain:
      replaced?{...domain,id:'replacement'}:null}),request:async(route,o)=>{
      assert.ok(route.endsWith('/'+domain.id));assert.equal(o.method,'DELETE');assert.equal(o.allow404,true);
      writes++;throw Object.assign(Error('Cloudflare control HTTP 500.'),{status:500});
    }});
    if(replaced)await assert.rejects(operation(),/attachment changed/);else await operation();
    assert.equal(writes,1);
  }
});
test('DNS orphan recovery requires a matching current domain record, not a placeholder or changeset alone',async()=>{
  for(const change of [{added:[{...domain,id:undefined}],updated:[],conflicting:[],removed:[]},
    {added:[],updated:[],conflicting:[{...domain,service:'another'}],removed:[]}]) {
    const calls=[];
    assert.equal(await recoverablePreviewDomain({zone,request:async(route,o)=>{
      calls.push(route);assert.equal(o.method,'POST');return {result:change};
    }}),null);assert.equal(calls.length,1);
  }
  assert.equal(await recoverablePreviewDomain({zone,request:async(route)=>route.includes('changeset')
    ?{result:{added:[domain],updated:[],conflicting:[],removed:[]}}:null}),null);
  const changes={added:[],updated:[domain],conflicting:[],removed:[]};
  for(const current of [null,{result:{...domain,service:'another'}},{result:domain}]) {
    let calls=0;
    const operation=()=>recoverablePreviewDomain({zone,request:async(route)=>{
      return ++calls===1?{result:changes}:current;
    }});
    if(current?.result?.service==='another')await assert.rejects(operation(),/another service/);
    else assert.deepEqual(await operation(),current?.result||null);
    assert.equal(calls,2);
  }
});
test('all isolated branch workflows use the bounded provisioner and preserve cleanup output contracts',()=>{
  for(const name of ['backend-gate','launch-load','launch-distributed','edge-preview']) {
    const workflow=fs.readFileSync(`.github/workflows/${name}.yml`,'utf8');
    assert.match(workflow,/run: node scripts\/create-ci-neon-branch\.mjs/);
    assert.doesNotMatch(workflow,/create-branch-action/);
    assert.match(workflow,/CI_BRANCH_PARENT: br-(?:orange-feather-ayps8kep|twilight-hill-ayffyd2b)/);
    assert.match(workflow,/steps\.neon\.outputs\.branch_id/);
    assert.match(workflow,/delete-branch-action/);
  }
});
