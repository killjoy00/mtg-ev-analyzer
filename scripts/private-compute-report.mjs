// Runs only on reviewed main in trusted Actions. Provider data never enters
// stdout, job summaries or public artifacts. No database/compute mutations.
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {collectComputeHistory,PROJECT} from './neon-compute-history.mjs';
import {controlRequest} from './control-read.mjs';

export const ACCOUNT='2eff4354681d85e7daa3ee437d64498c',BUCKET='pack1-private-operations';
const BASE=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}`;
const HOUR=3600000,DAY=24*HOUR,MAX_BYTES=20*1024*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
export function reportWindows(now=Date.now()) {
 const hour=Math.floor(now/HOUR)*HOUR,day=Math.floor(now/DAY)*DAY;
 const date=new Date(now),month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
 const result=[{from:new Date(hour-167*HOUR).toISOString(),to:new Date(hour).toISOString(),granularity:'hourly'}];
 if(month<day)result.unshift({from:new Date(month).toISOString(),to:new Date(day).toISOString(),granularity:'daily'});
 return result;
}
export function privateStore({token,fetcher=fetch}={}) {
 if(!token)throw Error('Private storage credential unavailable');
 const read=async route=>{
   const response=await fetcher(BASE+route,{method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error('Private storage read unavailable');
   return response;
 };
 const verify=async()=>{
   const managed=await (await read('/domains/managed')).json(),custom=await (await read('/domains/custom')).json();
   if(managed.success!==true||managed.result?.enabled!==false||custom.success!==true||!Array.isArray(custom.result?.domains)||custom.result.domains.length)
     throw Error('Private destination verification failed');
 };
 const keyPath=key=>{
   if(!/^compute-history\/(?:[0-9]+-[0-9]+\/report|ownership)\.json$/.test(key))throw Error('Unreviewed private object key');
   return '/objects/'+key;
 };
 return {verify,async ownership(){
   const response=await fetcher(BASE+keyPath('compute-history/ownership.json'),{method:'GET',redirect:'error',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
   if(response.status===404)return [];
   if(!response.ok)throw Error('Private ownership read unavailable');
   const result=await response.json();if(!Array.isArray(result))throw Error('Invalid private ownership evidence');return result;
 },async save(key,value){
   await verify(); // Recheck immediately before writing, not just at startup.
   const body=JSON.stringify(value)+'\n';if(Buffer.byteLength(body)>MAX_BYTES)throw Error('Private report exceeds bound');
   const route=keyPath(key);
   // Unique run/attempt key, exactly one PUT. An ambiguous upload is verified
   // by a read; it is never blindly retried or uploaded to another destination.
   try {
     const response=await fetcher(BASE+route,{method:'PUT',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw Error('Private upload unavailable');
   } catch { /* Readback below determines whether the upload committed. */ }
   const actual=await (await read(route)).text();
   if(digest(actual)!==digest(body))throw Error('Private report readback mismatch');
 }};
}
export async function branchInventory({key,fetcher=fetch}={}) {
 const params=new URLSearchParams({include_deleted:'true',limit:'100',sort_by:'created_at',sort_order:'asc'});
 const cursors=new Set(),rows=new Map();
 for(let page=0;page<1000;page++) {
   const response=await controlRequest(`https://console.neon.tech/api/v2/projects/${PROJECT}/branches?${params}`,{provider:'Neon',token:key,fetcher});
   if(!Array.isArray(response?.branches))throw Error('Invalid branch inventory');
   for(const b of response.branches) {
     if(!/^br-[a-z0-9-]+$/.test(b.id||'')||b.project_id!==PROJECT)throw Error('Unexpected branch inventory identity');
     const row={id:b.id,name:b.name,parent_id:b.parent_id??null,created_at:b.created_at,deleted_at:b.recovery?.deleted_at??null,expires_at:b.expires_at??null};
     if(rows.has(b.id)&&JSON.stringify(rows.get(b.id))!==JSON.stringify(row))throw Error('Conflicting branch inventory');
     rows.set(b.id,row);
   }
   const cursor=response.pagination?.next??response.pagination?.cursor;
   if(cursor==null||cursor==='')return [...rows.values()];
   if(typeof cursor!=='string'||cursors.has(cursor))throw Error('Repeated branch inventory cursor');
   cursors.add(cursor);params.set('cursor',cursor);
 }
 throw Error('Branch inventory exceeded bound');
}
export async function runPrivateReport({neonKey,cloudflareToken,runId,attempt,sha,now=Date.now(),fetcher=fetch}={}) {
 if(!neonKey||!/^\d+$/.test(runId||'')||!/^\d+$/.test(attempt||'')||!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Trusted collection context unavailable');
 const storage=privateStore({token:cloudflareToken,fetcher});
 await storage.verify();
 const report={schema:'private-compute-report-v1',observed_at:new Date(now).toISOString(),source_revision:sha,run_id:runId,run_attempt:attempt,
   reports:[],branch_inventory:[],problems:[],raw_history_pages:[]};
 let phase='ownership',bytes=0;
 const capture=async(url,options)=>{
   const response=await fetcher(url,options);
   // Only these read-only usage responses are retained. Never capture request
   // headers, credentials, arbitrary API bodies or account/profile metadata.
   const u=new URL(url);
   if(response.ok&&u.origin==='https://console.neon.tech'&&/^\/api\/v2\/consumption_history\/v2\/(projects|branches)$/.test(u.pathname)) {
     const body=await response.clone().text();bytes+=Buffer.byteLength(body);
     if(bytes>MAX_BYTES/2)throw Error('Private history capture exceeded bound');
     report.raw_history_pages.push({path:u.pathname,query:Object.fromEntries(u.searchParams),body:JSON.parse(body)});
   }
   return response;
 };
 try {
   const ownership=await storage.ownership();
   phase='inventory';
   try {report.branch_inventory=await branchInventory({key:neonKey,fetcher});}
   catch(error){report.problems.push({phase,http_status:error.status??null});}
   phase='history';
   for(const window of reportWindows(now))report.reports.push(await collectComputeHistory({key:neonKey,window,ownership,now,fetcher:capture}));
 } catch(error) {report.problems.push({phase,http_status:error.status??null});}
 await storage.save(`compute-history/${runId}-${attempt}/report.json`,report);
 return {available:report.reports.length===reportWindows(now).length&&report.reports.every(r=>r.project.frames.length>0&&r.branches.frames.length>0)};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 try {
   if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Reviewed main required');
   const result=await runPrivateReport({neonKey:process.env.NEON_API_KEY,cloudflareToken:process.env.CLOUDFLARE_EDGE_TOKEN,
     runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,sha:process.env.GITHUB_SHA});
   console.log(result.available?'Private compute history saved and readback verified. Coverage and attribution require private review.':'Private capability/validation report saved. Complete compute history is not established.');
   if(!result.available)process.exitCode=1;
 } catch {console.error('Private compute collection failed. No usage details or credentials were published.');process.exitCode=1;}
}
