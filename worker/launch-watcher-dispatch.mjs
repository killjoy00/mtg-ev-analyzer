import {createHash} from 'node:crypto';

export const LAUNCH_WATCHER_DISPATCH_STATE_KEY='launch_watcher_recovery_dispatch_v1';
export const LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS=3;
export const LAUNCH_WATCHER_DISPATCH_FAILURE_RETRY_MS=10*60*1000;
export const LAUNCH_WATCHER_DISPATCH_NO_PROGRESS_RETRY_MS=20*60*1000;
export const LAUNCH_WATCHER_DISPATCH_IN_FLIGHT_TIMEOUT_MS=10*60*1000;

const GITHUB_DISPATCH_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/launch-alert.yml/dispatches';
const STATUS=new Set(['fresh','stale','dispatching','dispatched','failed','exhausted']);

function iso(value) {
  const time=Number(value);
  if(!Number.isFinite(time))throw Error('Invalid launch watcher dispatch clock');
  return new Date(time).toISOString();
}

function parseTime(value) {
  if(value===null||value===undefined)return null;
  const time=Date.parse(value);
  if(!Number.isFinite(time))throw Error('Invalid launch watcher dispatch timestamp');
  return new Date(time).toISOString();
}

function defaultState() {
  return {
    version:1,status:'fresh',episode_id:null,started_at:null,attempts:0,
    last_attempt_at:null,last_progress_at:null,covered_through:null,recovered_at:null,
  };
}

export function parseLaunchWatcherDispatchState(value) {
  if(value===null||value===undefined||value==='')return defaultState();
  let parsed=value;
  if(typeof value==='string') {
    try {parsed=JSON.parse(value);} catch {throw Error('Invalid launch watcher dispatch state');}
  }
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.version!==1||!STATUS.has(parsed.status))
    throw Error('Invalid launch watcher dispatch state');
  const episode=parsed.episode_id===null||parsed.episode_id===undefined?null:String(parsed.episode_id);
  if(episode&&!/^[a-f0-9]{24}$/.test(episode))throw Error('Invalid launch watcher dispatch episode');
  const attempts=Number(parsed.attempts||0);
  if(!Number.isInteger(attempts)||attempts<0||attempts>LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS)
    throw Error('Invalid launch watcher dispatch attempts');
  return {
    version:1,
    status:parsed.status,
    episode_id:episode,
    started_at:parseTime(parsed.started_at),
    attempts,
    last_attempt_at:parseTime(parsed.last_attempt_at),
    last_progress_at:parseTime(parsed.last_progress_at),
    covered_through:parseTime(parsed.covered_through),
    recovered_at:parseTime(parsed.recovered_at),
  };
}

function episodeId(clock,freshness) {
  return createHash('sha256')
    .update(['pack1-launch-watchdog',iso(clock),freshness?.reason||'unknown',freshness?.covered_through||'none'].join(':'))
    .digest('hex')
    .slice(0,24);
}

function token(env) {
  const value=String(env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||'');
  if(!/^github_pat_[A-Za-z0-9_]{20,}$/.test(value))
    throw Error('Launch watcher GitHub dispatch credential is unavailable');
  return value;
}

export function launchWatcherRecoveryConfigured(env=process.env) {
  return /^github_pat_[A-Za-z0-9_]{20,}$/.test(String(env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||''));
}

async function loadState(query) {
  const result=await query('SELECT value FROM settings WHERE key=$1 LIMIT 1',[LAUNCH_WATCHER_DISPATCH_STATE_KEY]);
  const raw=result?.rows?.[0]?.value??null;
  return {raw:raw===null?null:String(raw),state:parseLaunchWatcherDispatchState(raw)};
}

async function compareAndSet(query,raw,state) {
  const value=JSON.stringify(parseLaunchWatcherDispatchState(state));
  const result=raw===null
    ?await query(`INSERT INTO settings(key,value) VALUES($1,$2)
      ON CONFLICT(key) DO NOTHING
      RETURNING value`,[LAUNCH_WATCHER_DISPATCH_STATE_KEY,value])
    :await query(`UPDATE settings SET value=$3
      WHERE key=$1 AND value=$2
      RETURNING value`,[LAUNCH_WATCHER_DISPATCH_STATE_KEY,raw,value]);
  return result?.rows?.[0]?.value?String(result.rows[0].value):null;
}

function elapsed(now,value) {
  if(!value)return Infinity;
  return Math.max(0,now-Date.parse(value));
}

async function dispatchLaunchWatcher(fetcher,env) {
  let response;
  try {
    response=await fetcher(GITHUB_DISPATCH_URL,{
      method:'POST',
      headers:{
        authorization:'Bearer '+token(env),
        accept:'application/vnd.github+json',
        'content-type':'application/json',
        'x-github-api-version':'2022-11-28',
        'user-agent':'pack1-launch-watchdog',
      },
      body:JSON.stringify({ref:'main',inputs:{continuation_depth:'0'}}),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(Error('Launch watcher GitHub dispatch request failed'),{code:'dispatch_request_failed'});
  }
  if(![200,204].includes(response.status))
    throw Object.assign(Error('Launch watcher GitHub dispatch was rejected'),{code:'dispatch_http_'+response.status,status:response.status});
}

export async function reconcileLaunchWatcherDispatch({query,freshness,now=Date.now(),env=process.env,fetcher=fetch}={}) {
  if(typeof query!=='function')throw Error('Launch watcher dispatch query is required');
  if(!freshness||typeof freshness.ok!=='boolean')throw Error('Launch watcher freshness result is required');
  const detectedAt=iso(now);

  for(let pass=0;pass<5;pass++) {
    const {raw,state}=await loadState(query);

    if(freshness.ok) {
      if(state.status==='fresh')return {action:'healthy',attempts:0};
      const clean={...defaultState(),recovered_at:detectedAt,covered_through:freshness.covered_through||null};
      if(await compareAndSet(query,raw,clean))return {action:'recovered',attempts:state.attempts};
      continue;
    }

    if(state.status==='fresh') {
      const started={
        version:1,status:'stale',episode_id:episodeId(now,freshness),started_at:detectedAt,attempts:0,
        last_attempt_at:null,last_progress_at:detectedAt,covered_through:freshness.covered_through||null,recovered_at:null,
      };
      if(await compareAndSet(query,raw,started))continue;
      continue;
    }

    const covered=freshness.covered_through||null;
    if(covered&&covered!==state.covered_through) {
      const progress={...state,status:'stale',covered_through:covered,last_progress_at:detectedAt};
      if(await compareAndSet(query,raw,progress))
        return {action:'progress',attempts:state.attempts,episode_id:state.episode_id,covered_through:covered};
      continue;
    }

    if(state.attempts>=LAUNCH_WATCHER_DISPATCH_MAX_ATTEMPTS) {
      if(state.status==='exhausted')
        return {action:'exhausted',attempts:state.attempts,episode_id:state.episode_id};
      const exhausted={...state,status:'exhausted'};
      if(await compareAndSet(query,raw,exhausted))
        return {action:'exhausted',attempts:state.attempts,episode_id:state.episode_id};
      continue;
    }

    const sinceAttempt=elapsed(now,state.last_attempt_at);
    const sinceProgress=elapsed(now,state.last_progress_at);
    if(state.status==='dispatching'&&sinceAttempt<LAUNCH_WATCHER_DISPATCH_IN_FLIGHT_TIMEOUT_MS)
      return {action:'in_flight',attempts:state.attempts,episode_id:state.episode_id};
    if(state.status==='failed'&&sinceAttempt<LAUNCH_WATCHER_DISPATCH_FAILURE_RETRY_MS)
      return {action:'cooldown',attempts:state.attempts,episode_id:state.episode_id};
    if((state.status==='dispatched'||state.status==='stale')&&state.attempts>0
      &&Math.min(sinceAttempt,sinceProgress)<LAUNCH_WATCHER_DISPATCH_NO_PROGRESS_RETRY_MS)
      return {action:'cooldown',attempts:state.attempts,episode_id:state.episode_id};

    const claimed={
      ...state,status:'dispatching',attempts:state.attempts+1,last_attempt_at:detectedAt,
      covered_through:covered||state.covered_through,
    };
    const claimedRaw=await compareAndSet(query,raw,claimed);
    if(!claimedRaw)continue;

    try {
      await dispatchLaunchWatcher(fetcher,env);
      const dispatched={...claimed,status:'dispatched'};
      const finalRaw=await compareAndSet(query,claimedRaw,dispatched);
      if(!finalRaw)throw Error('Launch watcher dispatch state did not finalize');
      return {action:'dispatched',attempts:dispatched.attempts,episode_id:dispatched.episode_id};
    } catch(error) {
      const failed={...claimed,status:'failed'};
      const finalRaw=await compareAndSet(query,claimedRaw,failed);
      if(!finalRaw)throw Error('Launch watcher dispatch failure state did not finalize');
      return {
        action:'failed',attempts:failed.attempts,episode_id:failed.episode_id,
        reason:String(error?.code||'dispatch_failed').slice(0,80),
      };
    }
  }

  throw Error('Launch watcher dispatch state contention did not settle');
}
