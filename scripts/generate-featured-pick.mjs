// Read a bounded, privacy-safe aggregate of yesterday's universal Dailies.
// Uses the existing GitHub Neon control-plane secret; never logs connection URIs.
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FEATURED_SQL,selectFeaturedPick,featureCopies,pacificDay,previousPacificDay} from './featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';

const PROJECT='patient-shadow-91417882';
const BRANCH='br-orange-feather-ayps8kep';
const DIR='artifacts/featured-pick';

export async function assertFeaturedMorning({env=process.env,now=new Date(),fetcher=fetch}={}) {
 if(!['schedule','workflow_dispatch','push'].includes(env.GITHUB_EVENT_NAME))
  throw Error('Featured publication requires a reviewed scheduled or manual workflow.');
 if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')
  throw Error('Featured publication is restricted to main.');
 const today=pacificDay(now);
 // One-time corrective push may execute only on October 25, 2026 Pacific.
 if(env.GITHUB_EVENT_NAME==='push'&&today!=='2026-10-25')
  return {eligible:false,reason:'one-time correction date has passed'};
 if(env.SOURCE_PACIFIC_DAY&&env.SOURCE_PACIFIC_DAY!==today)
  return {eligible:false,reason:'stale Neon dispatch'};
 if(env.GITHUB_EVENT_NAME==='schedule') {
  if(!/^\d+$/.test(env.GITHUB_RUN_ID||'')||!env.GITHUB_TOKEN)
   throw Error('Featured scheduled run provenance is missing.');
  const response=await fetcher('https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/runs/'+env.GITHUB_RUN_ID,{
   headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json'},
   redirect:'error',signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error('Featured schedule provenance is unavailable.');
  const run=await response.json();
  const scheduled=new Date(run.created_at);
  if(run.event!=='schedule'||Number.isNaN(scheduled.getTime())||
     pacificDay(scheduled)!==today)return {eligible:false,reason:'stale scheduled run'};
 }
 const clock=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
   .filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 if(Number(clock.hour)<7)return {eligible:false,reason:'before Pacific morning window'};
 await assertCurrentLivePublisher({env,fetchImpl:fetcher});
 return {eligible:true,day:previousPacificDay(now)};
}

export async function featureDbRows(day,{apiKey=process.env.NEON_API_KEY,fetcher=fetch}={}) {
 if(typeof apiKey!=='string'||apiKey.length<20)throw Error('Featured Neon API credential is missing.');
 const uri=new URL('https://console.neon.tech/api/v2/projects/'+PROJECT+'/connection_uri');
 uri.searchParams.set('branch_id',BRANCH);
 uri.searchParams.set('database_name','pack1');
 uri.searchParams.set('role_name','pack1_owner');
 uri.searchParams.set('pooled','false');
 const response=await fetcher(uri.toString(),{
  headers:{authorization:'Bearer '+apiKey,accept:'application/json'},redirect:'error',
  signal:AbortSignal.timeout(20000),
 });
 if(!response.ok)throw Error('Featured Neon credential lookup returned HTTP '+response.status+'.');
 const json=await response.json();
 const connection=new URL(json?.uri);
 if(!['postgresql:','postgres:'].includes(connection.protocol)||
    !/\.neon\.tech$/.test(connection.hostname)||connection.pathname!=='/pack1')
  throw Error('Featured Neon connection did not target the approved production database.');
 const {default:pg}=await import('pg');
 const client=new pg.Client({connectionString:json.uri,connectionTimeoutMillis:15000,
  query_timeout:30000});
 try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const result=await client.query(FEATURED_SQL,[day]);
  await client.query('COMMIT');
  return result.rows;
 } catch(error) {
  await client.query('ROLLBACK').catch(()=>{});
  throw Object.assign(Error('Featured read-only aggregate query failed'),{code:error.code});
 } finally {await client.end().catch(()=>{});}
}
export async function generateFeatured({env=process.env,now=new Date(),fetcher=fetch}={}) {
 const gate=await assertFeaturedMorning({env,now,fetcher});
 const output=async(selected,day='')=>{
  if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,'selected='+selected+'\nday='+day+'\n');
 };
 if(!gate.eligible){await output(false);return {selected:false,reason:gate.reason};}
 const rows=await featureDbRows(gate.day,{apiKey:env.NEON_API_KEY,fetcher});
 const selected=selectFeaturedPick(rows,{day:gate.day});
 if(!selected) {await output(false,gate.day);return {selected:false,day:gate.day,reason:'no qualified split'};}
 await mkdir(DIR,{recursive:true});
 const copy=featureCopies(selected);
 await writeFile(DIR+'/pick.json',JSON.stringify({feature:selected,copy},null,2)+'\n');
 await writeFile(DIR+'/patreon.md',copy.patreon+'\n');
 await output(true,gate.day);
 return {selected:true,day:gate.day,environment:selected.environment,round:selected.round,
  tier:selected.tier,players:selected.players,score:selected.score};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
 generateFeatured().then(result=>console.log(JSON.stringify(result)))
  .catch(error=>{console.error(error instanceof Error?error.message:'Featured pick failed.');
   process.exitCode=1;});
}
