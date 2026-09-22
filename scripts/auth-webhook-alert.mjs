const ALERT_TITLE='[authhook alert] Production recovery webhook failure';
const ALERT_STATUSES=new Set(['invalid_signature','delivery_failure','rejected_event']);
const QUERY_WINDOW_MS=15*60*1000;
const RECENT_COMMENT_WINDOW_MS=30*60*1000;

function boundedString(value,max) {
  return typeof value==='string'&&value.length>0&&value.length<=max?value:null;
}

export function buildTelemetryQuery(from,to,service='pack1-authhook') {
  return {
    queryId:'pack1-authhook-production-failures',
    timeframe:{from,to},
    dry:true,
    limit:200,
    parameters:{
      datasets:['cloudflare-workers'],
      filterCombination:'and',
      filters:[
        {key:'$metadata.service',operation:'eq',type:'string',value:service},
        {key:'$metadata.message',operation:'includes',type:'string',value:'"type":"pack1_authhook_timing"'},
        {
          kind:'group',
          filterCombination:'or',
          filters:[...ALERT_STATUSES].map(status=>({
            key:'$metadata.message',operation:'includes',type:'string',value:'"status":"'+status+'"',
          })),
        },
      ],
      view:'events',
    },
  };
}

function eventMessage(event) {
  if(typeof event?.$metadata?.message==='string')return event.$metadata.message;
  if(typeof event?.source==='string')return event.source;
  return null;
}

export function parseAlertEvent(event) {
  const id=boundedString(event?.$metadata?.id,160);
  const message=eventMessage(event);
  if(!id||!message)return null;
  let timing;
  try {timing=JSON.parse(message);} catch {return null;}
  if(timing?.type!=='pack1_authhook_timing'||!ALERT_STATUSES.has(timing?.status))return null;
  const timestamp=Number(event?.timestamp);
  const at=Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
  return {
    id,
    at,
    status:timing.status,
    event_type:boundedString(timing.event_type,64),
    link_type:boundedString(timing.link_type,64),
    delivery_attempt:boundedString(String(timing.delivery_attempt??''),32),
  };
}

export function extractAlertEvents(body) {
  const rows=body?.result?.events?.events;
  if(!Array.isArray(rows))return [];
  const seen=new Set();
  const events=[];
  for(const row of rows) {
    const event=parseAlertEvent(row);
    if(!event||seen.has(event.id))continue;
    seen.add(event.id);
    events.push(event);
  }
  return events.sort((a,b)=>String(a.at||'').localeCompare(String(b.at||'')));
}

async function cloudflareJson(fetcher,url,token,options={},label='request') {
  const response=await fetcher(url,{
    ...options,
    headers:{
      accept:'application/json',
      authorization:'Bearer '+token,
      ...(options.body?{'content-type':'application/json'}:{}),
      ...(options.headers||{}),
    },
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success===false) {
    const first=Array.isArray(body?.errors)?body.errors[0]:null;
    const code=Number.isFinite(Number(first?.code))?String(first.code):'none';
    const message=first?.message?String(first.message).slice(0,160):'request rejected';
    throw Error('Cloudflare '+label+' failed: HTTP '+response.status+', code '+code+', '+message+'.');
  }
  return body;
}

export async function verifyCloudflareToken(fetcher,token) {
  if(typeof token!=='string'||token.length<20)throw Error('CLOUDFLARE_EDGE_TOKEN is missing or too short.');
  const body=await cloudflareJson(fetcher,'https://api.cloudflare.com/client/v4/user/tokens/verify',token,{},'token verification');
  const id=boundedString(body?.result?.id,32);
  const status=boundedString(body?.result?.status,16);
  if(!id||status!=='active')throw Error('Cloudflare token verification did not return an active token id.');
  return {id,status};
}

export async function queryAlertEvents(fetcher,token,now=Date.now(),service='pack1-authhook') {
  if(typeof token!=='string'||token.length<20)throw Error('CLOUDFLARE_EDGE_TOKEN is missing or too short.');
  const zones=await cloudflareJson(fetcher,'https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',token,{},'zone lookup');
  const active=Array.isArray(zones?.result)?zones.result.filter(zone=>zone?.status==='active'):[];
  if(active.length!==1||!/^[a-f0-9]{32}$/.test(active[0]?.account?.id||''))throw Error('Expected one active Pack One Cloudflare zone with an account id.');
  const accountId=active[0].account.id;
  const payload=buildTelemetryQuery(now-QUERY_WINDOW_MS,now,service);
  const result=await cloudflareJson(
    fetcher,
    'https://api.cloudflare.com/client/v4/accounts/'+accountId+'/workers/observability/telemetry/query',
    token,
    {method:'POST',body:JSON.stringify(payload)},
    'observability telemetry query',
  );
  return extractAlertEvents(result);
}

function marker(id) {
  return '<!-- pack1-authhook-event:'+id+' -->';
}
function display(value) {
  return value===null||value===undefined||value===''?'(none)':String(value).replaceAll('|','\\|');
}
export function renderAlertBody(events) {
  const lines=[
    'Production recovery webhook failure telemetry was detected in retained Cloudflare Workers logs.',
    '',
    'Alert route: this GitHub issue is assigned to the repository owner. The watcher polls every five minutes with a fifteen-minute overlap and deduplicates by Cloudflare event id.',
    '',
    '| Time | Status | event_type | link_type | Attempt |',
    '| --- | --- | --- | --- | --- |',
  ];
  for(const event of events)lines.push('| '+display(event.at)+' | \`'+display(event.status)+'\` | \`'+display(event.event_type)+'\` | \`'+display(event.link_type)+'\` | '+display(event.delivery_attempt)+' |');
  lines.push('',...events.map(event=>marker(event.id)));
  return lines.join('\n');
}

async function githubJson(fetcher,url,token,options={}) {
  const response=await fetcher(url,{
    ...options,
    headers:{
      accept:'application/vnd.github+json',
      authorization:'Bearer '+token,
      'x-github-api-version':'2022-11-28',
      ...(options.body?{'content-type':'application/json'}:{}),
      ...(options.headers||{}),
    },
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error('GitHub alert routing failed with HTTP '+response.status+'.');
  return body;
}

export async function routeGithubAlert(fetcher,{repository,token,events,now=Date.now(),title=ALERT_TITLE}) {
  if(!Array.isArray(events)||events.length===0)return {action:'none',count:0};
  if(typeof token!=='string'||token.length<20)throw Error('GITHUB_TOKEN is missing or too short.');
  const match=/^([^/]+)\/([^/]+)$/.exec(String(repository||''));
  if(!match)throw Error('GITHUB_REPOSITORY is invalid.');
  const [,owner,repo]=match;
  const base='https://api.github.com/repos/'+owner+'/'+repo;
  const issues=await githubJson(fetcher,base+'/issues?state=open&per_page=100',token);
  const existing=Array.isArray(issues)?issues.find(issue=>issue?.title===title&&!issue?.pull_request):null;
  if(!existing) {
    const created=await githubJson(fetcher,base+'/issues',token,{
      method:'POST',
      body:JSON.stringify({title,body:renderAlertBody(events),assignees:[owner]}),
    });
    return {action:'created',count:events.length,issue_number:created?.number||null};
  }

  const since=new Date(now-RECENT_COMMENT_WINDOW_MS).toISOString();
  const comments=await githubJson(fetcher,base+'/issues/'+existing.number+'/comments?per_page=100&since='+encodeURIComponent(since),token);
  const evidence=[String(existing.body||''),...(Array.isArray(comments)?comments.map(comment=>String(comment?.body||'')):[])].join('\n');
  const fresh=events.filter(event=>!evidence.includes(marker(event.id)));
  if(fresh.length===0)return {action:'deduped',count:0,issue_number:existing.number};
  await githubJson(fetcher,base+'/issues/'+existing.number+'/comments',token,{method:'POST',body:JSON.stringify({body:renderAlertBody(fresh)})});
  return {action:'commented',count:fresh.length,issue_number:existing.number};
}

export async function runAlert({fetcher=fetch,env=process.env,now=Date.now(),mode='alert'}={}) {
  const verified=mode==='check'?await verifyCloudflareToken(fetcher,env.CLOUDFLARE_EDGE_TOKEN):null;
  if(verified)console.log('Cloudflare token active; token id '+verified.id+'.');
  const service=env.PACK1_AUTHHOOK_ALERT_SERVICE||'pack1-authhook';
  const title=env.PACK1_AUTHHOOK_ALERT_TITLE||ALERT_TITLE;
  const events=await queryAlertEvents(fetcher,env.CLOUDFLARE_EDGE_TOKEN,now,service);
  if(mode==='check') {
    console.log('Auth webhook alert query access verified; matching retained failures: '+events.length+'.');
    return {action:'checked',count:events.length};
  }
  if(mode!=='alert')throw Error('Unknown auth webhook alert mode.');
  const result=await routeGithubAlert(fetcher,{repository:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN,events,now,title});
  console.log('Auth webhook alert route '+result.action+'; new events '+result.count+'.');
  return result;
}

if(import.meta.url===new URL('file://'+process.argv[1]).href) {
  runAlert({mode:process.argv[2]||'alert'}).catch(error=>{
    console.error(String(error?.message||'Auth webhook alert failed.'));
    process.exitCode=1;
  });
}
