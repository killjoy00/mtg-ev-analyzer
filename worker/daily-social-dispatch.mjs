import {zonedDateTime} from './neon-trigger.mjs';
import {launchWatcherRecoveryConfigured} from './launch-watcher-dispatch.mjs';

// Neon owns the clock. GitHub retains its secret-backed publisher and the
// existing Discord receipt / Bluesky record deduplication.
export const DAILY_SOCIAL_TRIGGER_NAME='pack1-daily-social-dispatch';
const DISPATCH_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/daily-social-post.yml/dispatches';
const RETRY_MINUTES=new Set([10,20,40]);
const MAX_LATENESS_MS=2*60*60*1000;

export function socialDispatchEligibility(scheduledAt,now=new Date()) {
  const scheduledMs=Date.parse(scheduledAt);
  const nowMs=new Date(now).getTime();
  if(!Number.isFinite(scheduledMs)||!Number.isFinite(nowMs))
    throw Error('Invalid Daily social scheduler clock');
  const scheduled=zonedDateTime(scheduledAt,'America/Los_Angeles');
  const wall=zonedDateTime(new Date(nowMs).toISOString(),'America/Los_Angeles');
  if(scheduled.hour!==7||!RETRY_MINUTES.has(scheduled.minute))
    return {eligible:false,day:scheduled.date,reason:'off_window'};
  if(scheduled.date!==wall.date||wall.hour<7||nowMs<scheduledMs-30000||
     nowMs-scheduledMs>MAX_LATENESS_MS)
    return {eligible:false,day:scheduled.date,reason:'stale'};
  return {eligible:true,day:scheduled.date};
}

export async function dispatchDailySocialFromNeon({
  trigger,now=new Date(),env=process.env,fetcher=fetch,
}={}) {
  if(trigger?.name!==DAILY_SOCIAL_TRIGGER_NAME)
    throw Object.assign(Error('Daily social trigger identity denied'),{status:403});
  const eligible=socialDispatchEligibility(trigger.scheduledAt,now);
  if(!eligible.eligible)return {action:'skipped',day:eligible.day,reason:eligible.reason};
  if(!launchWatcherRecoveryConfigured(env))
    throw Error('Production GitHub dispatch credential is unavailable');
  let response;
  try {
    response=await fetcher(DISPATCH_URL,{
      method:'POST',
      headers:{
        authorization:'Bearer '+env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN,
        accept:'application/vnd.github+json',
        'content-type':'application/json',
        'x-github-api-version':'2022-11-28',
        'user-agent':'pack1-daily-social-scheduler',
      },
      body:JSON.stringify({ref:'main',inputs:{live:'true',source_day:eligible.day}}),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    throw Error('Daily social workflow dispatch request failed');
  }
  if(![200,204].includes(response.status))
    throw Error('Daily social workflow dispatch rejected (HTTP '+Number(response.status||0)+')');
  return {action:'dispatched',day:eligible.day};
}
