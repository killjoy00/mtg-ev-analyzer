import {createHash} from 'node:crypto';

export const LAUNCH_WATCHER_ALERT_STATE_KEY='launch_watcher_operator_alert_v1';
export const LAUNCH_WATCHER_ALERT_SENDER='Pack One <accounts@packone.pro>';
const RESEND_URL='https://api.resend.com/emails';
const STATUS=new Set(['fresh','stale_pending','stale','recovery_pending']);

function iso(value) {
  const time=Number(value);
  if(!Number.isFinite(time))throw Error('Invalid launch watcher alert clock');
  return new Date(time).toISOString();
}

function defaultState() {
  return {version:1,status:'fresh',episode_id:null,started_at:null,alerted_at:null,recovered_at:null,reason:null,covered_through:null};
}

function parseTime(value) {
  if(value===null||value===undefined)return null;
  const time=Date.parse(value);
  if(!Number.isFinite(time))throw Error('Invalid launch watcher alert timestamp');
  return new Date(time).toISOString();
}

export function parseLaunchWatcherAlertState(value) {
  if(value===null||value===undefined||value==='')return defaultState();
  let parsed=value;
  if(typeof value==='string') {
    try {parsed=JSON.parse(value);} catch {throw Error('Invalid launch watcher alert state');}
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.version!==1||!STATUS.has(parsed.status))
    throw Error('Invalid launch watcher alert state');
  const episode=parsed.episode_id===null||parsed.episode_id===undefined?null:String(parsed.episode_id);
  if(episode&&!/^[a-f0-9]{24}$/.test(episode))throw Error('Invalid launch watcher alert episode');
  return {
    version:1,
    status:parsed.status,
    episode_id:episode,
    started_at:parseTime(parsed.started_at),
    alerted_at:parseTime(parsed.alerted_at),
    recovered_at:parseTime(parsed.recovered_at),
    reason:parsed.reason===null||parsed.reason===undefined?null:String(parsed.reason).slice(0,80),
    covered_through:parseTime(parsed.covered_through),
  };
}

async function loadState(query) {
  const result=await query('SELECT value FROM settings WHERE key=$1 LIMIT 1',[LAUNCH_WATCHER_ALERT_STATE_KEY]);
  return parseLaunchWatcherAlertState(result?.rows?.[0]?.value??null);
}

async function saveState(query,state) {
  const clean=parseLaunchWatcherAlertState(state);
  const value=JSON.stringify(clean);
  const result=await query(`INSERT INTO settings(key,value) VALUES($1,$2)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
    RETURNING value`,[LAUNCH_WATCHER_ALERT_STATE_KEY,value]);
  if(!result?.rows?.[0]?.value)throw Error('Launch watcher alert state did not persist');
  return parseLaunchWatcherAlertState(result.rows[0].value);
}

function alertConfig(env) {
  const apiKey=String(env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
  const destination=String(env.PACK1_LAUNCH_ALERT_EMAIL||'').trim();
  if(!apiKey.startsWith('re_')||apiKey.length<=3)throw Error('Launch watcher operator email key is unavailable');
  if(!/^[^@\s]+@[^@\s]+$/.test(destination))throw Error('Launch watcher operator email destination is unavailable');
  return {apiKey,destination};
}

function episodeId(clock,freshness) {
  return createHash('sha256')
    .update(['pack1-launch-watcher',iso(clock),freshness?.reason||'unknown',freshness?.covered_through||'none'].join(':'))
    .digest('hex')
    .slice(0,24);
}

function field(value) {
  return value===null||value===undefined?'unknown':String(value);
}

async function sendOperatorEmail({env,fetcher,kind,episode,freshness,detectedAt,startedAt}) {
  const {apiKey,destination}=alertConfig(env);
  const recovered=kind==='recovered';
  const subject=recovered?'[Pack One] Launch coverage recovered':'[Pack One] Launch coverage stale';
  const text=recovered
    ?[
      'Pack One launch-monitor coverage has recovered.',
      '',
      'Recovered at: '+detectedAt,
      'Covered through: '+field(freshness.covered_through),
      'Current coverage age (minutes): '+field(freshness.age_minutes),
      'Stale episode started: '+field(startedAt),
      '',
      'Coverage state: https://github.com/killjoy00/mtg-ev-analyzer/issues/596',
      'No action is required if the launch-alert workflow remains current.',
    ].join('\n')
    :[
      'Pack One launch-monitor coverage is stale.',
      '',
      'Detected at: '+detectedAt,
      'Reason: '+field(freshness.reason),
      'Covered through: '+field(freshness.covered_through),
      'Coverage age (minutes): '+field(freshness.age_minutes),
      'Freshness limit (minutes): '+field(freshness.max_age_minutes),
      '',
      'Coverage state: https://github.com/killjoy00/mtg-ev-analyzer/issues/596',
      'Inspect the production launch-alert workflow and Neon pack1growth logs. Do not clear the alert by raising the freshness limit.',
    ].join('\n');
  const response=await fetcher(RESEND_URL,{
    method:'POST',
    headers:{
      authorization:'Bearer '+apiKey,
      'content-type':'application/json',
      'Idempotency-Key':'pack1-launch-'+kind+'-'+episode,
    },
    body:JSON.stringify({
      from:LAUNCH_WATCHER_ALERT_SENDER,
      to:[destination],
      subject,
      text,
    }),
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Object.assign(Error('Launch watcher operator email failed'),{status:response.status});
}

export async function reconcileLaunchWatcherAlert({query,freshness,now=Date.now(),env=process.env,fetcher=fetch}={}) {
  if(typeof query!=='function')throw Error('Launch watcher alert query is required');
  if(!freshness||typeof freshness.ok!=='boolean')throw Error('Launch watcher freshness result is required');
  const detectedAt=iso(now);
  const current=await loadState(query);

  if(freshness.ok) {
    if(current.status==='fresh')return {action:'healthy'};
    const episode=current.episode_id||episodeId(now,{reason:'recovery',covered_through:freshness.covered_through});
    const pending=current.status==='recovery_pending'
      ?current
      :await saveState(query,{...current,status:'recovery_pending',episode_id:episode,recovered_at:null});
    await sendOperatorEmail({
      env,fetcher,kind:'recovered',episode,freshness,detectedAt,startedAt:pending.started_at,
    });
    await saveState(query,{
      version:1,status:'fresh',episode_id:null,started_at:null,alerted_at:null,recovered_at:detectedAt,
      reason:null,covered_through:freshness.covered_through||null,
    });
    return {action:'recovered',episode_id:episode};
  }

  if(current.status==='stale')return {action:'deduplicated',episode_id:current.episode_id};
  const pending=current.status==='stale_pending'
    ?current
    :await saveState(query,{
      version:1,status:'stale_pending',episode_id:episodeId(now,freshness),started_at:detectedAt,
      alerted_at:null,recovered_at:null,reason:freshness.reason||'unknown',
      covered_through:freshness.covered_through||null,
    });
  await sendOperatorEmail({
    env,fetcher,kind:'stale',episode:pending.episode_id,freshness,detectedAt,startedAt:pending.started_at,
  });
  await saveState(query,{
    ...pending,status:'stale',alerted_at:detectedAt,reason:freshness.reason||pending.reason,
    covered_through:freshness.covered_through||pending.covered_through,
  });
  return {action:'alerted',episode_id:pending.episode_id};
}
