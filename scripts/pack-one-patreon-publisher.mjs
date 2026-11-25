// The ONE supported desktop entry point for all Pack One Patreon articles.
// Existing series keep independent durable receipts, but every PostyBirb
// operation uses a single pairing, shared pinned bridge, and serial tick.
// No arbitrary remote scripts, executable download, or unapproved posting.
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import * as paired from './pack-one-weekly-private-runner.mjs';

const STATUSES=new Set([
 'outside-window','waiting-feed','public-confirmed','already-verified','verified',
 'receipt-exists','queued-awaiting-verification','review-required','unexpected-public-post',
 'failed-closed','not-connected','schema-unavailable','guide-draft-awaiting-approval',
 'guide-evidence-unavailable','lab-awaiting-approval','season-check-failed','lab-check-failed'
]);
export function pickDue(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 return ['Wed','Thu'].includes(parts.weekday)&&Number(parts.hour)>=9;
}
export async function runUnifiedTick({call,bridge,now=new Date(),
 recap=paired.runPairedWeeklyTick,season=paired.runPairedSeasonTick,lab=paired.runPairedLabTick}){
 // The existing status call authenticates the current owner pairing. A
 // revoked or unavailable pairing stops every automatic publication lane.
 const history=await call('status');
 if(!Array.isArray(history.pending)||history.pending.length>20)throw Error('publisher-pairing-unavailable');
 const result={recap:'not-connected',pick:'outside-window',season:'not-connected',lab:'not-connected'};
 const run=async(key,fn)=>{
  try {
   const value=await fn();
   result[key]=STATUSES.has(value?.status)?value.status:'failed-closed';
  }catch{result[key]='failed-closed';}
 };
 // Pick uses the original immutable public v2 manifest and same local
 // Wednesday journal, never the old v1 daily feed. The Python bridge also
 // enforces the Chicago window. No pick submission outside this gate.
 if(pickDue(now))await run('pick',()=>bridge('pick-tick',{}));
 // These calls MUST remain sequential, never Promise.all. Each content lane
 // owns admission, exact-version approval, claim, and public reconciliation.
 // A failed lane cannot block independent due articles after authentication.
 for(const [key,tick] of [['recap',recap],['season',season],['lab',lab]]){
  if(typeof tick==='function')await run(key,()=>tick({call,bridge}));
 }
 return result;
}
export async function publisherMain({env=process.env,once=false,check=false}={}){
 const call=paired.createWeeklyApi({env});
 const bridge=(action,post)=>paired.callLocalBridge(action,post,{env});
 if(check){
  const result=await call('check');
  if(result.status!=='connections-verified')throw Error('publisher-connection-unavailable');
  await bridge('check',{});
  console.log('pack-one-publisher:connections-verified');
  return;
 }
 do{
  try{
   const result=await runUnifiedTick({call,bridge});
   console.log('pack-one-publisher:'+JSON.stringify(result));
  }catch{
   console.error('pack-one-publisher:failed-closed');
   if(once)process.exitCode=1;
  }
  if(!once)await sleep(60_000);
 }while(!once);
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 publisherMain({once:process.argv.includes('--once'),check:process.argv.includes('--check-config')}).catch(()=>{
  console.error('pack-one-publisher:configuration-unavailable');process.exitCode=1;
 });
}
