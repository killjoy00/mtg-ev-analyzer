import test from 'node:test';
import assert from 'node:assert/strict';
import {authWebhookIngress} from '../edge/auth-webhook-ingress.mjs';

const release='a'.repeat(40);
const qa={MODE:'qa',NEON_BRANCH_ID:'br-twilight-hill-ayffyd2b',RELEASE_COMMIT:release};
const prod={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',RELEASE_COMMIT:release};
const raw=' { "event_type" : "send.magic_link", "event_data" : { "token" : "fixture" } }\n';

function request(path='/webhook',options={}) {
  return new Request('https://pack1-authhook-qa.example'+path,{
    method:options.method||'POST',
    headers:{
      'content-type':'application/json',
      'x-neon-signature':'header..signature',
      'x-neon-signature-kid':'kid',
      'x-neon-timestamp':'1758484579000',
      'x-neon-event-type':'send.magic_link',
      'x-neon-event-id':'550e8400-e29b-41d4-a716-446655440000',
      'x-neon-delivery-attempt':'1',
      'authorization':'Bearer must-drop',
      'cookie':'must-drop=1',
      'origin':'https://evil.example',
      ...options.headers,
    },
    body:options.method==='GET'?undefined:(options.body??raw),
  });
}

test('dedicated Auth ingress forwards exact bytes and only the fixed Neon envelope',async()=>{
  let forwarded=0;
  const response=await authWebhookIngress(request(),qa,async(url,options)=>{
    forwarded++;
    assert.equal(url,'https://br-twilight-hill-ayffyd2b-pack1authhook.compute.c-5.us-east-2.aws.neon.tech/webhook');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'manual');
    assert.equal(Buffer.from(options.body).toString('utf8'),raw,'raw bytes must not be parsed or reserialized');
    for(const name of ['content-type','x-neon-signature','x-neon-signature-kid','x-neon-timestamp','x-neon-event-type','x-neon-event-id','x-neon-delivery-attempt'])
      assert.equal(options.headers.get(name),request().headers.get(name));
    for(const name of ['authorization','cookie','origin','cf-connecting-ip','x-forwarded-for'])
      assert.equal(options.headers.get(name),null);
    return new Response(null,{status:204,headers:{'set-cookie':'drop=1','x-secret':'drop'}});
  });
  assert.equal(forwarded,1);
  assert.equal(response.status,204);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('x-secret'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('production Auth ingress is pinned to the production fourth function',async()=>{
  let upstream;
  const response=await authWebhookIngress(request(),prod,async(url)=>{
    upstream=url;
    return new Response(null,{status:503});
  });
  assert.equal(upstream,'https://br-orange-feather-ayps8kep-pack1authhook.compute.c-5.us-east-2.aws.neon.tech/webhook');
  assert.equal(response.status,503);
});

test('Auth ingress health exposes the exact reviewed release and rejects partial configuration',async()=>{
  const health=await authWebhookIngress(request('/health?quick=1',{method:'GET'}),qa,()=>{throw Error('no upstream');});
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{ok:true,service:'pack1-authhook-ingress',mode:'qa',release_commit:release});

  for(const env of [
    {...qa,RELEASE_COMMIT:'bad'},
    {...qa,NEON_BRANCH_ID:'br-orange-feather-ayps8kep'},
    {...prod,NEON_BRANCH_ID:'br-twilight-hill-ayffyd2b'},
    {...qa,MODE:'preview'},
  ]) {
    assert.equal((await authWebhookIngress(request('/health?quick=1',{method:'GET'}),env,()=>{throw Error('no');})).status,503);
  }
});

test('Auth ingress allows only the webhook POST and quick health GET',async()=>{
  const noFetch=()=>{throw Error('Must not forward');};
  assert.equal((await authWebhookIngress(request('/other'),qa,noFetch)).status,404);
  assert.equal((await authWebhookIngress(request('/webhook',{method:'GET'}),qa,noFetch)).status,405);
  assert.equal((await authWebhookIngress(request('/health',{method:'GET'}),qa,noFetch)).status,404);
  assert.equal((await authWebhookIngress(request('/webhook',{body:'x'.repeat(64*1024+1)}),qa,noFetch)).status,413);
  assert.equal((await authWebhookIngress(request('/webhook',{headers:{'content-length':String(64*1024+1)}}),qa,noFetch)).status,413);
});

test('Auth ingress converts upstream transport errors and redirects into failures',async()=>{
  assert.equal((await authWebhookIngress(request(),qa,async()=>{throw Error('network');})).status,503);
  assert.equal((await authWebhookIngress(request(),qa,async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}}))).status,502);
});
