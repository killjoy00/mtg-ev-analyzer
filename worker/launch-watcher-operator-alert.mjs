import {randomUUID} from 'node:crypto';

export const LAUNCH_WATCHER_ALERT_STATE_KEY='launch_watcher_operator_alert_v1';
export const LAUNCH_WATCHER_ALERT_SENDER='Pack One <accounts@packone.pro>';

function operatorConfig(env=process.env) {
  const email=String(env.PACK1_DELETION_ADMIN_EMAIL||'').trim();
  const key=String(env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
  if(!email.includes('@')||!key.startsWith('re_')||key.length<=3)
    throw Error('Launch watcher operator alert is not configured');
  return {email,key};
}

function normalizeState(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if(value.version!==1||!['pending','active','recovery_pending','recovered'].includes(value.status))return null;
  if(typeof value.incident_id!=='string'||!/^[0-9a-f-]{36}$/i.test(value.incident_id))return null;
  return {
    version:1,
    status:value.status,
    incident_id:value.incident_id,
    opened_at:typeof value.opened_at==='string'?value.opened_at:null,
    notified_at:typeof value.notified_at==='string'?value.notified_at:null,
    recovered_at:typeof value.recovered_at==='string'?value.recovered_at:null,
    reason:typeof value.reason==='string'?value.reason:null,
    covered_through:typeof value.covered_through==='string'?value.covered_through:null,
  };
}

async function loadState(query) {
  const result=await query('SELECT value FROM settings WHERE key=$1 LIMIT 1',[LAUNCH_WATCHER_ALERT_STATE_KEY]);
  const raw=result?.rows?.[0]?.value;
  if(raw==null)return null;
  let parsed;
  try {parsed=JSON.parse(raw);} catch {throw Error('Launch watcher operator alert state is invalid');}
  const state=normalizeState(parsed);
  if(!state)throw Error('Launch watcher operator alert state is invalid');
  return state;
}

async function saveState(query,state) {
  const normalized=normalizeState(state);
  if(!normalized)throw Error('Launch watcher operator alert state is invalid');
  await query(`INSERT INTO settings(key,value) VALUES($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,[
    LAUNCH_WATCHER_ALERT_STATE_KEY,JSON.stringify(normalized),
  ]);
  return normalized;
}

async function sendOperatorEmail({kind,state,freshness,releaseCommit,env,fetcher}) {
  const {email,key}=operatorConfig(env);
  const recovered=kind==='recovered';
  const subject=recovered
    ?'[Pack One] Launch watcher coverage recovered'
    :'[Pack One] Launch watcher coverage stale';
  const lines=[
    recovered?'Pack One launch-monitor coverage has recovered.':'Pack One launch-monitor coverage is stale.',
    '',
    'Reason: '+String(freshness.reason||'unknown'),
    'Covered through: '+String(freshness.covered_through||'unknown'),
    'Age minutes: '+String(Number.isFinite(freshness.age_minutes)?freshness.age_minutes:'unknown'),
    'Maximum age minutes: '+String(freshness.max_age_minutes||30),
    'Release: '+String(releaseCommit||'unknown'),
    'Incident: '+state.incident_id,
  ];
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      authorization:'Bearer '+key,
      'content-type':'application/json',
      'Idempotency-Key':`pack1-launch-watcher-${state.incident_id}-${kind}`,
    },
    body:JSON.stringify({
      from:LAUNCH_WATCHER_ALERT_SENDER,
      to:[email],
      subject,
      text:lines.join('\n'),
    }),
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('Launch watcher operator email failed with HTTP '+response.status);
}

export async function syncLaunchWatcherOperatorAlert({
  query,
  freshness,
  releaseCommit='unknown',
  now=Date.now(),
  env=process.env,
  fetcher=fetch,
}={}) {
  if(typeof query!=='function')throw Error('Launch watcher operator alert query is required');
  if(!freshness||typeof freshness.ok!=='boolean')throw Error('Launch watcher freshness is required');
  const current=await loadState(query);
  const timestamp=new Date(now).toISOString();

  if(freshness.ok) {
    if(!current||current.status==='recovered')return {ok:true,status:'clear',notified:false};
    const recovering=await saveState(query,{
      ...current,
      status:'recovery_pending',
      recovered_at:timestamp,
      reason:freshness.reason||current.reason,
      covered_through:freshness.covered_through||current.covered_through,
    });
    try {
      await sendOperatorEmail({kind:'recovered',state:recovering,freshness,releaseCommit,env,fetcher});
    } catch(error) {
      return {ok:false,status:'recovery_pending',notified:false,error:String(error.message||error).slice(0,160)};
    }
    await saveState(query,{...recovering,status:'recovered'});
    return {ok:true,status:'recovered',notified:true};
  }

  if(current?.status==='active')return {ok:true,status:'active',notified:false,incident_id:current.incident_id};

  const pending=await saveState(query,{
    version:1,
    status:'pending',
    incident_id:current?.status==='pending'?current.incident_id:randomUUID(),
    opened_at:current?.status==='pending'&&current.opened_at?current.opened_at:timestamp,
    notified_at:current?.status==='pending'?current.notified_at:null,
    recovered_at:null,
    reason:freshness.reason||'coverage_stale',
    covered_through:freshness.covered_through||null,
  });
  try {
    await sendOperatorEmail({kind:'stale',state:pending,freshness,releaseCommit,env,fetcher});
  } catch(error) {
    return {ok:false,status:'pending',notified:false,incident_id:pending.incident_id,error:String(error.message||error).slice(0,160)};
  }
  const active=await saveState(query,{...pending,status:'active',notified_at:timestamp});
  return {ok:true,status:'active',notified:true,incident_id:active.incident_id};
}
