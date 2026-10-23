// Private, read-only consumption collector. Never print provider payloads.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {controlRequest} from './control-read.mjs';
export const PROJECT='patient-shadow-91417882',METRIC='compute_unit_seconds';
const HOUR=3600000,DAY=24*HOUR;
const timestamp=s=>{const n=Date.parse(s);if(typeof s!=='string'||!s.endsWith('Z')||!Number.isFinite(n))throw Error('Invalid history timestamp');return n;};
export function historyWindow({from,to,granularity,now=Date.now()}) {
 const start=timestamp(from),end=timestamp(to),unit={hourly:HOUR,daily:DAY}[granularity];
 if(!unit||start%unit||end%unit||start>=end||end>now||start<now-(granularity==='hourly'?168*HOUR:60*DAY))
   throw Error('History requires aligned, retained hourly or daily bounds');
 return {from:new Date(start).toISOString(),to:new Date(end).toISOString(),granularity};
}
export async function fetchHistory(kind,{key,org,window,fetcher=fetch}) {
 if(!['projects','branches'].includes(kind)||!key||!org)throw Error('Missing history capability');
 const params=new URLSearchParams({org_id:org,project_ids:PROJECT,...window,metrics:METRIC,limit:'100'});
 const rows=[],cursors=new Set();
 for(let page=0;page<1000;page++) {
   const data=await controlRequest('https://console.neon.tech/api/v2/consumption_history/v2/'+kind+'?'+params,
     {provider:'Neon',token:key,fetcher});
   if(!Array.isArray(data?.[kind]))throw Error('Unexpected consumption history schema');
   rows.push(...data[kind]);
   const cursor=data.pagination?.cursor;
   if(cursor==null||cursor==='')return rows;
   if(typeof cursor!=='string'||cursors.has(cursor))throw Error('Repeated or invalid consumption cursor');
   cursors.add(cursor);params.set('cursor',cursor);
 }
 throw Error('Consumption history pagination exceeded bound');
}
export function normalizeHistory(rows,kind,window) {
 const frames=new Map(),problems=[],entities=new Set(),periods=new Map();
 for(const row of rows) {
   if(row.project_id!==PROJECT||!Array.isArray(row.periods))throw Error('Wrong project or missing history periods');
   const entity=kind==='branches'?row.branch_id:row.project_id;
   if(typeof entity!=='string'||!entity)throw Error('Missing history entity');
   entities.add(entity);
   if(!row.periods.length)problems.push({entity,reason:'missing_periods'});
   for(const period of row.periods) {
     if(typeof period.period_id!=='string'||!Array.isArray(period.consumption))throw Error('Missing billing period identity');
     const start=timestamp(period.period_start),end=period.period_end?timestamp(period.period_end):Infinity;
     if(start>=end)throw Error('Invalid billing period');
     const periodKey=entity+'|'+period.period_id;
     const identity=JSON.stringify([period.period_start,period.period_end??null,period.period_plan??null]);
     if(periods.has(periodKey)&&periods.get(periodKey)!==identity)throw Error('Conflicting billing period identity');
     periods.set(periodKey,identity);
     if(!period.consumption.length)problems.push({entity,reason:'missing_frames',period:period.period_id});
     for(const frame of period.consumption) {
       const from=timestamp(frame.timeframe_start),to=timestamp(frame.timeframe_end);
       if(from>=to||from<start||to>end||from<timestamp(window.from)||to>timestamp(window.to))throw Error('Consumption frame outside requested or billing window');
       const metrics=frame.metrics?.filter(m=>m.metric_name===METRIC)||[];
       if(metrics.length!==1){problems.push({entity,reason:'missing_or_duplicate_compute_metric',from:frame.timeframe_start});continue;}
       const value=metrics[0].value;
       if(!Number.isFinite(value)||value<0)throw Error('Invalid compute metric');
       const key=[entity,period.period_id,from,to].join('|');
       const normalized={entity,period_id:period.period_id,period_plan:period.period_plan??null,
         from:new Date(from).toISOString(),to:new Date(to).toISOString(),compute_unit_seconds:value};
       if(frames.has(key)&&JSON.stringify(frames.get(key))!==JSON.stringify(normalized))throw Error('Conflicting duplicate consumption frame');
       frames.set(key,normalized);
     }
   }
 }
 const ordered=[...frames.values()].sort((a,b)=>a.entity.localeCompare(b.entity)||timestamp(a.from)-timestamp(b.from));
 const last=new Map();
 for(const frame of ordered) {
   const previous=last.get(frame.entity);
   if(previous&&timestamp(frame.from)<timestamp(previous.to))throw Error('Overlapping consumption frames or billing periods');
   if(previous&&timestamp(frame.from)>timestamp(previous.to))problems.push({entity:frame.entity,reason:'history_gap',from:previous.to,to:frame.from});
   last.set(frame.entity,frame);
 }
 if(!ordered.length)problems.push({reason:'no_compute_history'});
 return {frames:ordered,problems,entities:[...entities]};
}
export function reconcileHistory(project,branches,window,ownership=[]) {
 const frameKey=f=>[f.period_id,f.period_plan,f.from,f.to].join('|'),projectFrames=new Map(project.frames.map(f=>[frameKey(f),f]));
 const matchedWindows=new Set(branches.frames.map(frameKey));
 const matchingHistory=!project.problems.length&&!branches.problems.length&&branches.frames.every(f=>projectFrames.has(frameKey(f)))&&
   project.frames.every(f=>matchedWindows.has(frameKey(f)))&&project.frames[0]?.from===window.from&&project.frames.at(-1)?.to===window.to;
 const measuredProject=project.frames.reduce((n,f)=>n+f.compute_unit_seconds,0);
 const measuredBranches=branches.frames.reduce((n,f)=>n+f.compute_unit_seconds,0);
 const comparable=matchingHistory&&measuredBranches<=measuredProject;
 const totals=new Map();
 for(const frame of branches.frames)totals.set(frame.entity,(totals.get(frame.entity)||0)+frame.compute_unit_seconds);
 const fixed={'br-orange-feather-ayps8kep':'production','br-twilight-hill-ayffyd2b':'development'};
 const byBranch=[...totals].map(([branch_id,seconds])=>{
   const matches=ownership.filter(e=>e.branch_id===branch_id&&e.project_id===PROJECT&&
     ['creation_receipt','deletion_receipt','workflow_receipt'].includes(e.evidence_type)&&
     typeof e.evidence_ref==='string'&&e.evidence_ref&&['CI','investigation','other'].includes(e.owner));
   const owners=new Set(matches.map(e=>e.owner));
   return {branch_id,cu_hours:seconds/3600,owner:fixed[branch_id]||(owners.size===1?[...owners][0]:'unattributed'),
     ownership_evidence:matches,deleted:matches.some(e=>e.evidence_type==='deletion_receipt')};
 });
 return {comparable,project_reported_cu_hours:project.frames.length?measuredProject/3600:null,
   returned_branch_cu_hours:branches.frames.length?measuredBranches/3600:null,
   unattributed_difference_cu_hours:comparable?(measuredProject-measuredBranches)/3600:null,
   branches:byBranch,settlement:'provisional',settlement_verified:false,
   interpretation:'Returned history only. A project-minus-branch difference is unattributed, never inferred CI usage. Missing metrics and plan/history boundaries are not zero usage.',
   functions_costs:'Excluded. Functions capacity-hours and invocations are separate from Postgres CU-hours.'};
}
export async function collectComputeHistory({key,window,fetcher=fetch,ownership=[],now=Date.now()}={}) {
 window=historyWindow({...window,now});
 const metadata=await controlRequest('https://console.neon.tech/api/v2/projects/'+PROJECT,{provider:'Neon',token:key,fetcher});
 if(metadata?.project?.id!==PROJECT||!metadata.project.org_id)throw Error('Project organization unavailable');
 const history={};
 for(const kind of ['projects','branches']) {
   try {history[kind]=normalizeHistory(await fetchHistory(kind,{key,org:metadata.project.org_id,window,fetcher}),kind,window);}
   catch(error){if(![403,404].includes(error.status))throw error;history[kind]={frames:[],entities:[],problems:[{reason:'capability_unavailable',http_status:error.status}]};}
 }
 return {schema:'private-neon-compute-history-v1',observed_at:new Date(now).toISOString(),window,
   project:history.projects,branches:history.branches,reconciliation:reconcileHistory(history.projects,history.branches,window,ownership)};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 try {
   const [from,to,granularity,output,ownershipFile]=process.argv.slice(2);
   if(!output||!path.isAbsolute(output)||output.includes('/artifacts/'))throw Error('Private absolute output path required');
   const report=await collectComputeHistory({key:process.env.NEON_API_KEY,window:{from,to,granularity},
     ownership:ownershipFile?JSON.parse(fs.readFileSync(ownershipFile)):[]});
   fs.writeFileSync(output,JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'});
   console.log('Private compute-history collection completed. No usage details were published.');
 } catch {console.error('Private compute-history collection failed; no attribution established.');process.exitCode=1;}
}
