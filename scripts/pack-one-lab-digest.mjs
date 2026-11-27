// Scheduled private research digest. The old article pipeline stays disabled.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {articleHash} from '../worker/lab-editorial.mjs';
import {databaseURL} from './pack-one-lab-weekly.mjs';
import {buildStoredCorpusReport} from '../research/pack-one-lab/stored-corpus.mjs';
import {DIGEST_KIND,admission,collectIdeas,selectIdeas,renderDigest} from '../research/pack-one-lab/digest-ideas.mjs';

const FROM='Pack One <accounts@packone.pro>';
// Reuse the established Lab owner notification address, never a user database.
const TO='admin@packone.pro';
const fail=code=>{throw Error('digest-'+code);};
const queryHistory="SELECT source_key,report,report_hash FROM public.pack1_lab_research WHERE state='ready' AND (source_key LIKE 'ideas-digest-v1-%' OR source_key LIKE 'ideas-digest-test-v1-%') ORDER BY attempted_at DESC LIMIT 104";
function verify(row){
 const r=row?.report;
 if(!r||r.kind!==DIGEST_KIND||articleHash(r)!==row.report_hash||!Array.isArray(r.idea_ids)||r.idea_ids.some(x=>typeof x!=='string')||!['claimed','sent'].includes(r.delivery))fail('receipt-integrity');
 return r;
}
export async function sendDigest(query,{mode,ideas,apiKey,fetcher=fetch}){
 if(!apiKey?.startsWith('re_'))fail('email-unconfigured');
 const existing=(await query('SELECT source_key,report,report_hash FROM public.pack1_lab_research WHERE source_key=$1',[mode.key])).rows[0];
 if(existing){if(verify(existing).delivery==='sent')return {status:'already-sent'};fail('previous-claim-needs-reconciliation');}
 const content=renderDigest(ideas,mode);
 const receipt={kind:DIGEST_KIND,mode:mode.kind,date:mode.date,idea_ids:ideas.map(i=>i.id),payload_hash:articleHash(content),delivery:'claimed'};
 const claimHash=articleHash(receipt);
 const claim=await query("INSERT INTO public.pack1_lab_research(source_key,state,report,report_hash) VALUES($1,'ready',$2::jsonb,$3) ON CONFLICT(source_key) DO NOTHING RETURNING source_key",[mode.key,JSON.stringify(receipt),claimHash]);
 if(claim.rows.length!==1)fail('claim-conflict');
 // The claim remains durable if delivery is ambiguous. Never retry an
 // unknown outcome; provider idempotency is a second layer of protection.
 const res=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json','idempotency-key':mode.key},
  body:JSON.stringify({from:FROM,to:[TO],...content}),signal:AbortSignal.timeout(30000)});
 if(!res.ok)fail('email-unverified');
 const response=await res.json();
 if(typeof response?.id!=='string'||!response.id||response.id.length>128)fail('email-unverified');
 const sent={...receipt,delivery:'sent',provider_receipt:response.id};
 const saved=await query("UPDATE public.pack1_lab_research SET report=$2::jsonb,report_hash=$3 WHERE source_key=$1 AND state='ready' AND report_hash=$4 RETURNING source_key",[mode.key,JSON.stringify(sent),articleHash(sent),claimHash]);
 if(saved.rows.length!==1)fail('receipt-write');
 return {status:'provider-accepted',count:ideas.length};
}
export async function runDigest(client,{mode,apiKey,build=buildStoredCorpusReport,fetcher=fetch}={}){
 if(!apiKey?.startsWith('re_'))fail('email-unconfigured');
 const query=(sql,params=[])=>client.query(sql,params);
 await query('SET ROLE pack1_lab_research_worker');
 if((await query('SELECT current_user AS role')).rows[0]?.role!=='pack1_lab_research_worker')fail('role');
 // Separate advisory lock; never interact with the editorial queue or caches.
 if(!(await query('SELECT pg_try_advisory_lock(1791,20261126) AS locked')).rows[0]?.locked)return {status:'busy'};
 const existing=(await query('SELECT source_key,report,report_hash FROM public.pack1_lab_research WHERE source_key=$1',[mode.key])).rows[0];
 if(existing){if(verify(existing).delivery==='sent')return {status:'already-sent'};fail('previous-claim-needs-reconciliation');}
 let ideas;
 await query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await query("SET LOCAL statement_timeout='120000ms'");
  const history=(await query(queryHistory)).rows.flatMap(r=>verify(r).idea_ids);
  const report=await build(query);
  ideas=selectIdeas(collectIdeas(report),history);
  await query('COMMIT');
 }catch(error){await query('ROLLBACK');throw error;}
 return sendDigest(query,{mode,ideas,apiKey,fetcher});
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')fail('untrusted-ref');
 const cfg=JSON.parse(await readFile(new URL('../.github/pack-one-lab-digest.json',import.meta.url),'utf8'));
 const mode=admission(cfg,{event:process.env.DIGEST_EVENT,schedule:process.env.DIGEST_SCHEDULE,attempt:process.env.GITHUB_RUN_ATTEMPT});
 if(!mode){console.log('Private research digest is not due.');return;}
 const key=process.env.PACK1_LAB_RESEND_API_KEY;
 if(!key?.startsWith('re_'))fail('email-unconfigured');
 const {Client}=await import('pg');
 const client=new Client({connectionString:databaseURL(process.env.PACK1_LAB_DATABASE_URL),connectionTimeoutMillis:15000});
 await client.connect();
 try{
  const result=await runDigest(client,{mode,apiKey:key});
  if(result.status==='busy')fail('busy');
  console.log(result.status==='provider-accepted'?'Private digest accepted by the email provider. Ideas: '+result.count+'.':'Private digest already recorded; no new email.');
 }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(e=>{
  // Never print URLs, database errors, recipient, contents or provider responses.
  const allowed=['digest-email-unconfigured','digest-email-unverified','digest-receipt-write','digest-receipt-integrity','digest-previous-claim-needs-reconciliation','digest-claim-conflict','digest-busy','digest-role','digest-untrusted-ref','digest-config'];
  console.error('Private digest stopped: '+(allowed.includes(e?.message)?e.message:'research or configuration failure')+'. No article was published.');
  process.exitCode=1;
 });
