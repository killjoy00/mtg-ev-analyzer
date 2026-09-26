export const COVERAGE_ISSUE_NUMBER=596;
export const COVERAGE_ISSUE_TITLE='[launch watcher] Coverage state';
export const COVERAGE_MARKER='pack1-launch-coverage';
export const WINDOW_MS=15*60_000;
export const STEP_MS=5*60_000;
export const SETTLE_MS=2*60_000;
export const BOOTSTRAP_MS=2*60*60_000;
export const LATE_REPLAY_MS=30*60_000;
export const MIN_LOG_RETENTION_MS=3*24*60*60_000;
export const MAX_CATCHUP_WINDOWS=30;
export const STALE_COVERAGE_MS=30*60_000;
const ALERT_HISTORY_MS=12*60*60_000;

function iso(value) {
  if(typeof value!=='string')return null;
  const time=Date.parse(value);
  return Number.isFinite(time)?new Date(time).toISOString():null;
}

function alertMap(value) {
  const result={};
  if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const [key,alerts] of Object.entries(value)) {
    const end=iso(key);
    if(!end||!Array.isArray(alerts))continue;
    const clean=[...new Set(alerts.filter(alert=>typeof alert==='string'&&/^[a-z0-9_]{1,64}$/.test(alert)))].sort();
    if(clean.length)result[end]=clean;
  }
  return result;
}

export function normalizeCoverageState(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid launch coverage state');
  const version=Number(value.version);
  if(version!==1)throw Error('Unsupported launch coverage state version');
  const coverage_floor=value.coverage_floor===null||value.coverage_floor===undefined?null:iso(value.coverage_floor);
  const covered_through=value.covered_through===null||value.covered_through===undefined?null:iso(value.covered_through);
  const updated_at=value.updated_at===null||value.updated_at===undefined?null:iso(value.updated_at);
  if(value.coverage_floor!=null&&!coverage_floor)throw Error('Invalid launch coverage floor');
  if(value.covered_through!=null&&!covered_through)throw Error('Invalid launch coverage watermark');
  if(value.updated_at!=null&&!updated_at)throw Error('Invalid launch coverage update timestamp');
  if(coverage_floor&&covered_through&&Date.parse(covered_through)<Date.parse(coverage_floor))throw Error('Launch coverage watermark precedes floor');
  return {version:1,coverage_floor,covered_through,alerted_windows:alertMap(value.alerted_windows),updated_at};
}

export function parseCoverageState(body) {
  const match=String(body||'').match(new RegExp(`<!--\\s*${COVERAGE_MARKER}\\s*\\n([\\s\\S]*?)\\n-->`));
  if(!match)throw Error('Launch coverage state marker missing');
  let parsed;
  try {parsed=JSON.parse(match[1]);} catch {throw Error('Launch coverage state JSON invalid');}
  return normalizeCoverageState(parsed);
}

export function renderCoverageState(state) {
  const normalized=normalizeCoverageState(state);
  return [
    'Machine-managed, sanitized production launch-watcher coverage watermark. Do not use this issue as an incident; category alerts remain separate issues.',
    '',
    `<!-- ${COVERAGE_MARKER}`,
    JSON.stringify(normalized),
    '-->',
  ].join('\n');
}

function mergeAlertMaps(a,b,referenceTime) {
  const merged={};
  for(const source of [a,b])for(const [end,alerts] of Object.entries(source||{}))
    merged[end]=[...new Set([...(merged[end]||[]),...alerts])].sort();
  const reference=Number.isFinite(referenceTime)?referenceTime:Math.max(0,...Object.keys(merged).map(Date.parse));
  const cutoff=reference-ALERT_HISTORY_MS;
  for(const end of Object.keys(merged))if(Date.parse(end)<cutoff)delete merged[end];
  return merged;
}

export function mergeCoverageState(current,proposed,{now=Date.now()}={}) {
  const a=normalizeCoverageState(current),b=normalizeCoverageState(proposed);
  const floors=[a.coverage_floor,b.coverage_floor].filter(Boolean).map(Date.parse);
  const through=[a.covered_through,b.covered_through].filter(Boolean).map(Date.parse);
  const coverage_floor=floors.length?new Date(Math.min(...floors)).toISOString():null;
  const covered_through=through.length?new Date(Math.max(...through)).toISOString():null;
  const reference=covered_through?Date.parse(covered_through):now;
  return {
    version:1,
    coverage_floor,
    covered_through,
    alerted_windows:mergeAlertMaps(a.alerted_windows,b.alerted_windows,reference),
    updated_at:new Date(now).toISOString(),
  };
}

export function coverageTarget(now=Date.now()) {
  const value=Number(now)-SETTLE_MS;
  if(!Number.isFinite(value))throw Error('Invalid launch coverage clock');
  return Math.floor(value/STEP_MS)*STEP_MS;
}

function sequence(start,end,step=STEP_MS) {
  const result=[];
  for(let value=start;value<=end;value+=step)result.push(value);
  return result;
}

export function planCoverage(state,{now=Date.now()}={}) {
  const current=normalizeCoverageState(state||{version:1,coverage_floor:null,covered_through:null,alerted_windows:{},updated_at:null});
  const target=coverageTarget(now);
  const floor=current.coverage_floor?Date.parse(current.coverage_floor):target-BOOTSTRAP_MS;
  const covered=current.covered_through?Date.parse(current.covered_through):null;
  if(floor>target)throw Error('Launch coverage floor is in the future');
  if(covered!==null&&covered>target+STEP_MS)throw Error('Launch coverage watermark is in the future');

  const firstNew=covered===null?floor+WINDOW_MS:covered+STEP_MS;
  const allNew=firstNew<=target?sequence(firstNew,target):[];
  const selectedNew=allNew.slice(0,MAX_CATCHUP_WINDOWS);
  const replayStart=covered===null?null:Math.max(floor+WINDOW_MS,covered-LATE_REPLAY_MS+STEP_MS);
  const replay=replayStart!==null&&replayStart<=covered?sequence(replayStart,covered):[];
  const inspection=[...new Set([...replay,...selectedNew])].sort((a,b)=>a-b);
  const earliestMissingStart=allNew.length?allNew[0]-WINDOW_MS:null;
  const retentionFloor=Number(now)-MIN_LOG_RETENTION_MS;
  const unrecoverable=earliestMissingStart!==null&&earliestMissingStart<retentionFloor;

  return {
    target,
    coverageFloor:floor,
    previousCoveredThrough:covered,
    replayEnds:replay,
    allNewEnds:allNew,
    newEnds:selectedNew,
    inspectionEnds:inspection,
    pendingNewWindows:Math.max(0,allNew.length-selectedNew.length),
    retentionFloor,
    earliestMissingStart,
    unrecoverable,
    bootstrap:current.covered_through===null,
  };
}

export function withWindowAlerts(state,end,alerts) {
  const next=normalizeCoverageState(state);
  const endIso=new Date(end).toISOString();
  const clean=[...new Set((alerts||[]).filter(alert=>typeof alert==='string'&&/^[a-z0-9_]{1,64}$/.test(alert)))].sort();
  if(clean.length)next.alerted_windows[endIso]=[...new Set([...(next.alerted_windows[endIso]||[]),...clean])].sort();
  return next;
}
