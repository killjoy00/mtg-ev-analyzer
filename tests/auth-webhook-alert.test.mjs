import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTelemetryQuery,extractAlertEvents,renderAlertBody,routeGithubAlert} from '../scripts/auth-webhook-alert.mjs';

test('query targets structured Workers Logs failure fields for the selected authhook service',()=>{
  const q=buildTelemetryQuery(1000,2000,'pack1-authhook-qa');
  assert.deepEqual(q.timeframe,{from:1000,to:2000});
  assert.equal(q.view,'events');
  assert.equal(q.dry,true);
  assert.deepEqual(q.parameters.datasets,['cloudflare-workers']);
  const filters=q.parameters.filters;
  assert.deepEqual(filters[0],{key:'$metadata.service',operation:'eq',type:'string',value:'pack1-authhook-qa'});
  assert.deepEqual(filters[1],{key:'type',operation:'eq',type:'string',value:'pack1_authhook_timing'});
  assert.deepEqual(filters[2].filters.map(filter=>filter.key),['status','status','status']);
  assert.deepEqual(filters[2].filters.map(filter=>filter.value),['invalid_signature','delivery_failure','rejected_event']);
  assert.doesNotMatch(JSON.stringify(q),/\$metadata\.message/);
});

test('extraction reads structured source fields and exposes only whitelisted bounded timing fields',()=>{
  const body={result:{events:{events:[{
    timestamp:1790042400000,
    $metadata:{id:'cf-event-1'},
    source:{
      type:'pack1_authhook_timing',status:'rejected_event',event_type:'send.magic_link',link_type:'verify-email',delivery_attempt:'2',
      token:'do-not-leak',email:'person@example.com',
    },
  },{
    timestamp:1790042400001,
    $metadata:{id:'cf-event-2'},
    source:{type:'pack1_authhook_timing',status:'sent_or_duplicate',token:'x'},
  }]}}};
  const events=extractAlertEvents(body);
  assert.equal(events.length,1);
  assert.deepEqual(events[0],{
    id:'cf-event-1',at:new Date(1790042400000).toISOString(),status:'rejected_event',event_type:'send.magic_link',link_type:'verify-email',delivery_attempt:'2',
  });
  const rendered=renderAlertBody(events);
  assert.doesNotMatch(rendered,/do-not-leak|person@example\.com/);
  assert.match(rendered,/pack1-authhook-event:cf-event-1/);
});

test('extraction keeps metadata-message compatibility for older retained rows',()=>{
  const body={result:{events:{events:[{
    timestamp:1790042400000,
    $metadata:{id:'legacy-1',message:JSON.stringify({type:'pack1_authhook_timing',status:'invalid_signature',delivery_attempt:'1'})},
  }]}}};
  assert.equal(extractAlertEvents(body)[0].status,'invalid_signature');
});

test('GitHub route creates an assigned issue, supports a test title, and deduplicates event ids',async()=>{
  const calls=[];
  const event={id:'cf-event-1',at:'2026-09-22T02:00:00.000Z',status:'delivery_failure',event_type:'send.magic_link',link_type:'forget-password',delivery_attempt:'1'};
  const title='[authhook alert test] QA recovery webhook failure';
  const createFetch=async(url,init={})=>{
    calls.push({url,init});
    if(url.endsWith('/issues?state=open&per_page=100'))return Response.json([]);
    if(url.endsWith('/issues')&&init.method==='POST')return Response.json({number:321},{status:201});
    throw Error('unexpected '+url);
  };
  const created=await routeGithubAlert(createFetch,{repository:'killjoy00/mtg-ev-analyzer',token:'x'.repeat(40),events:[event],title});
  assert.deepEqual(created,{action:'created',count:1,issue_number:321});
  const payload=JSON.parse(calls.at(-1).init.body);
  assert.equal(payload.title,title);
  assert.deepEqual(payload.assignees,['killjoy00']);
  assert.match(payload.body,/delivery_failure/);
  assert.match(payload.body,/send\.magic_link/);
  assert.match(payload.body,/forget-password/);

  const dedupeFetch=async(url,init={})=>{
    if(url.endsWith('/issues?state=open&per_page=100'))return Response.json([{number:321,title,body:'<!-- pack1-authhook-event:cf-event-1 -->'}]);
    if(url.includes('/issues/321/comments?'))return Response.json([]);
    throw Error('unexpected '+url+' '+String(init.method||'GET'));
  };
  const deduped=await routeGithubAlert(dedupeFetch,{repository:'killjoy00/mtg-ev-analyzer',token:'x'.repeat(40),events:[event],title,now:1790042400000});
  assert.deepEqual(deduped,{action:'deduped',count:0,issue_number:321});
});
