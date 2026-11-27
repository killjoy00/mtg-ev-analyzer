import {createHash} from 'node:crypto';
import {launchWatcherRecoveryConfigured} from './launch-watcher-dispatch.mjs';
import {LAUNCH_WATCHER_ALERT_SENDER,LAUNCH_WATCHER_ALERT_DESTINATION} from './launch-watcher-alert.mjs';

// Neon owns the independent clock. Only the existing GitHub job can apply
// the complete, revision-checked Patreon snapshot and change entitlements.
// Share the existing 10-minute maintenance trigger, with no new invocation.
export const PATREON_RECONCILIATION_TRIGGER='pack1-account-deletion-maintenance';
export const PATREON_DISPATCH_KEY='patreon_reconciliation_dispatch_v1';
export const PATREON_ALERT_KEY='patreon_reconciliation_alert_v1';
const DISPATCH_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/patreon-reconcile.yml/dispatches';
const RESEND_URL='https://api.resend.com/emails';
const MIN_INTERVAL_MS=30*60*1000;
const MAX_LATENESS_MS=30*60*1000;

export async function inspectPatreonFreshness(query) {
  const result=await query(`SELECT count(*) AS linked,
    count(*) FILTER (WHERE last_synced_at<=now()-interval '60 minutes'
      OR last_synced_at>now() OR sync_requested_at IS NOT NULL) AS due,
    count(*) FILTER (WHERE last_synced_at<=now()-interval '120 minutes'
      OR last_synced_at>now() OR sync_requested_at<=now()-interval '120 minutes') AS stale,
    (SELECT value FROM settings WHERE key=$1) AS dispatch_state,
    (SELECT value FROM settings WHERE key=$2) AS alert_state
    FROM provider_accounts WHERE provider='patreon'`,[PATREON_DISPATCH_KEY,PATREON_ALERT_KEY]);
  const row=result?.rows?.[0];
  const counts=['linked','due','stale'].map(key=>{
    if(row?.[key]===null||row?.[key]===undefined||row?.[key]==='')throw Error('Missing Patreon freshness count');
    const value=Number(row[key]);
    if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid Patreon freshness count');
    return value;
  });
  const [linked,due,stale]=counts;
  if(stale>due||due>linked)throw Error('Inconsistent Patreon freshness counts');
  return {linked,due,stale,dispatchState:row.dispatch_state??null,alertState:row.alert_state??null};
}

async function cas(query,key,old,value) {
  const result=old===null
    ?await query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING value',[key,value])
    :await query('UPDATE settings SET value=$3 WHERE key=$1 AND value=$2 RETURNING value',[key,old,value]);
  return result?.rows?.[0]?.value===value;
}

async function dispatch({query,now,env,fetcher,old}) {
  if(!launchWatcherRecoveryConfigured(env))return 'unconfigured';
  const prior=old===null?null:Date.parse(old);
  if(prior!==null&&(!Number.isFinite(prior)||prior>now+30000))throw Error('Invalid Patreon dispatch clock');
  if(prior!==null&&now-prior<MIN_INTERVAL_MS)return 'cooldown';
  if(!await cas(query,PATREON_DISPATCH_KEY,old,new Date(now).toISOString()))return 'contended';
  // Persist the attempt before the request. Timeouts may have been accepted;
  // the next scheduled check retries after cooldown only if rows remain due.
  try {
    const response=await fetcher(DISPATCH_URL,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN,
        accept:'application/vnd.github+json','content-type':'application/json',
        'x-github-api-version':'2022-11-28','user-agent':'pack1-patreon-reconciliation'},
      body:JSON.stringify({ref:'main',inputs:{mode:'sync'}}),
    });
    return [200,204].includes(response.status)?'dispatched':'failed';
  } catch {return 'failed';}
}

async function alert({query,stale,now,env,fetcher,state}) {
  if(state!==null&&state!=='fresh'&&!/^(pending|sent):[a-f0-9]{24}$/.test(state))throw Error('Invalid Patreon alert state');
  if(!stale) {
    if(state&&state!=='fresh')await cas(query,PATREON_ALERT_KEY,state,'fresh');
    return 'healthy';
  }
  if(state?.startsWith('sent:'))return 'deduplicated';
  if(!state||state==='fresh') {
    const episode=createHash('sha256').update('pack1-patreon:'+new Date(now).toISOString()).digest('hex').slice(0,24);
    const pending='pending:'+episode;
    if(!await cas(query,PATREON_ALERT_KEY,state,pending))return 'contended';
    state=pending;
  }
  const key=String(env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
  if(!key.startsWith('re_')||key.length<=3)return 'unconfigured';
  const episode=state.slice('pending:'.length);
  // Identical request and provider idempotency key across retries; no member
  // identity or provider payload is ever included in the notification.
  try {
    const response=await fetcher(RESEND_URL,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+key,'content-type':'application/json','Idempotency-Key':'pack1-patreon-stale-'+episode},
      body:JSON.stringify({
        from:LAUNCH_WATCHER_ALERT_SENDER,to:[LAUNCH_WATCHER_ALERT_DESTINATION],
        subject:'[Pack One] Patreon membership reconciliation stale',
        text:'One or more linked Patreon membership snapshots or requested refreshes are at least two hours overdue, or have an invalid future timestamp. Free members may stop receiving ads after three hours; paid Elite grants expire after twelve hours. The Neon watchdog will retry the reviewed reconciliation workflow. Check the latest job and production snapshot timestamps: https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/patreon-reconcile.yml. Do not manually extend grants or bypass paid-member advertising protections.',
      }),
    });
    if(!response.ok)return 'failed';
    await cas(query,PATREON_ALERT_KEY,state,'sent:'+episode);
    return 'alerted';
  } catch {return 'failed';}
}

export async function reconcilePatreonWatchdog({trigger,query,now=Date.now(),env=process.env,fetcher=fetch}={}) {
  if(trigger?.name!==PATREON_RECONCILIATION_TRIGGER)
    throw Object.assign(Error('Patreon reconciliation trigger identity denied'),{status:403});
  const clock=new Date(now).getTime(),scheduled=Date.parse(trigger.scheduledAt);
  if(!Number.isFinite(clock)||!Number.isFinite(scheduled))throw Error('Invalid Patreon reconciliation scheduler clock');
  if(clock<scheduled-30000||clock-scheduled>MAX_LATENESS_MS||new Date(scheduled).getUTCMinutes()%10!==9)
    return {action:'skipped',reason:'off_window'};
  const {dispatchState,alertState,...freshness}=await inspectPatreonFreshness(query);
  let action='not_due',notification='healthy';
  // Attempt both recovery and notification independently even if one fails.
  if(freshness.due) {
    try {action=await dispatch({query,now:clock,env,fetcher,old:dispatchState});}
    catch {action='failed';}
  }
  try {notification=await alert({query,stale:freshness.stale,now:clock,env,fetcher,state:alertState});}
  catch {notification='failed';}
  return {...freshness,action,notification,ok:!freshness.stale&&!['failed','unconfigured'].includes(action)&&!['failed','unconfigured'].includes(notification)};
}
