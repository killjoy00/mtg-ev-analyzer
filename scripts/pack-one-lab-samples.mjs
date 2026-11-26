// Manual private evaluation. Same writer/reviewer and recent-set packet
// ranking as weekly Lab; no approval, scheduling, email or Patreon actions.
import {pathToFileURL} from 'node:url';
import {articleHash} from '../worker/lab-editorial.mjs';
import {makeArticle} from '../worker/lab-writer.mjs';
import {PENDING,taskArticle} from './pack-one-lab-task-bridge.mjs';
import {centralDate} from '../worker/lab-editorial.mjs';
import {buildStoredCorpusReport,cachedStoredCorpusPackets} from '../research/pack-one-lab/stored-corpus.mjs';
import {cardResearchPackets} from '../research/pack-one-lab/card-research.mjs';
import {selectPackets,databaseURL} from './pack-one-lab-weekly.mjs';
import {labPost} from '../lab-patreon-contract.mjs';

const permitted=new Set(['stored-card-analysis','stored-card-comparison']);
const fail=code=>{throw Error('lab-samples-'+code);};
export async function generateSampleBatch(packets,{writer,reviewer,generate=makeArticle,clock=()=>new Date(),models}={}){
 if(!Array.isArray(packets)||packets.some(p=>!permitted.has(p?.kind)||!p.id))fail('source');
 if(!models?.writer||!models?.reviewer||models.writer===models.reviewer)fail('distinct-models-required');
 const history=[],articles=[],attempted=[];
 // One bounded manual run. Avoid repeated topics and use normal selection.
 // A rejected candidate is not replaced with a manually written sample.
 for(let i=0;i<10&&articles.length<5;i++){
  const used=new Set(articles.map(a=>a.article.theme));
  const remaining=packets.filter(p=>!attempted.includes(p.id));
  const diverse=remaining.filter(p=>!used.has(p.theme||p.id));
  const choices=selectPackets(diverse.length?diverse:remaining,history,{state:'researching',attempted_ids:attempted});
  const packet=choices[0];
  if(!packet)break;
  attempted.push(packet.id);
  const article=await generate(packet,{writer,reviewer});
  if(!article)continue;
  // A real sample must also fit the currently supported Patreon transport.
  // Never truncate or alter a passed article to make it fit.
  try{labPost(article);}catch{continue;}
  articles.push({candidate_id:packet.id,evidence_hash:articleHash(packet),article_hash:articleHash(article),article});
  history.unshift({attempted_ids:[packet.id],editorial_mode:article.editorial_mode,theme:article.theme});
 }
 return {schema_version:1,kind:'private-editorial-samples',generated_at:clock().toISOString(),models:{writer:models.writer,reviewer:models.reviewer},attempted_count:attempted.length,status:articles.length===5?'complete':'partial',articles};
}

export async function runSampleBatch(query,{writer,reviewer,models,clock,build=buildStoredCorpusReport,packetsFor=cardResearchPackets}){
 // Read one verified retained-corpus snapshot. Do not write the weekly
 // research cache, issues or events; do not download historical archives.
 await query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',[]);
 let report;
 try{report=await build(query);await query('COMMIT',[]);}catch(e){await query('ROLLBACK',[]);throw e;}
 const batch=await generateSampleBatch(packetsFor(report),{writer,reviewer,models,clock});
 const result=await query('INSERT INTO pack1_lab_sample_batches(singleton,generated_at,sample_json,sample_hash) VALUES(true,$1::timestamptz,$2::jsonb,$3) ON CONFLICT(singleton) DO UPDATE SET generated_at=excluded.generated_at,sample_json=excluded.sample_json,sample_hash=excluded.sample_hash RETURNING singleton',[batch.generated_at,JSON.stringify(batch),articleHash(batch)]);
 if(result.rows.length!==1)fail('save');
 return {status:batch.status,count:batch.articles.length,attempted:batch.attempted_count};
}
// Prepare a bounded batch in a separate cache namespace. Each tick progresses
// immutable task requests; samples never enter pack1_lab_issues or publication.
export async function runTaskSamples(query,{now=new Date(),packets,generate=taskArticle}={}){
 const week=centralDate(now).week;
 const source=packets||await cachedStoredCorpusPackets(query,{week,namespace:'sample'});
 const history=[],attempted=[],articles=[];
 let pending=0;
 for(let i=0;i<10&&articles.length<5;i++){
  // Plan by the selected topics, not their eventual verdicts, so a later tick
  // cannot expand the ten-candidate budget or silently switch pending jobs.
  const themes=new Set(history.map(a=>a.theme));
  const available=source.filter(p=>!attempted.includes(p.id));
  const diverse=available.filter(p=>!themes.has(p.theme||p.id));
  const packet=selectPackets(diverse.length?diverse:available,history,{state:'researching',attempted_ids:attempted})[0];
  if(!packet)break;
  attempted.push(packet.id);
  history.unshift({attempted_ids:[packet.id],editorial_mode:packet.editorial_mode,theme:packet.theme||packet.id});
  const article=await generate(query,{scope:'samples',week,revision:0,packet});
  if(article===PENDING){pending++;continue;}
  if(!article)continue;
  try{labPost(article);}catch{continue;}
  articles.push({candidate_id:packet.id,evidence_hash:articleHash(packet),article_hash:articleHash(article),article});
 }
 if(articles.length<5&&pending)return {status:'awaiting-chatgpt',count:articles.length,attempted:attempted.length};
 const batch={schema_version:1,kind:'private-editorial-samples',generated_at:now.toISOString(),models:{writer:'ChatGPT writer task',reviewer:'ChatGPT editorial review task'},attempted_count:attempted.length,status:articles.length===5?'complete':'partial',articles};
 const result=await query('INSERT INTO pack1_lab_sample_batches(singleton,generated_at,sample_json,sample_hash) VALUES(true,$1::timestamptz,$2::jsonb,$3) ON CONFLICT(singleton) DO UPDATE SET generated_at=excluded.generated_at,sample_json=excluded.sample_json,sample_hash=excluded.sample_hash RETURNING singleton',[batch.generated_at,JSON.stringify(batch),articleHash(batch)]);
 if(result.rows.length!==1)fail('save');
 return {status:batch.status,count:articles.length,attempted:attempted.length};
}
async function main(){
 // Only the explicitly enabled private sample mode on the reviewed main workflow.
 if(process.env.PACK1_LAB_SAMPLE_MODE!=='true'||!['workflow_dispatch','schedule','push'].includes(process.env.GITHUB_EVENT_NAME)||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')fail('untrusted-run');
 const {Client}=await import('pg');
 const client=new Client({connectionString:databaseURL(process.env.PACK1_LAB_DATABASE_URL),connectionTimeoutMillis:15000});
 await client.connect();
 try{
  await client.query('SET ROLE pack1_lab_research_worker');
  const lock=await client.query('SELECT pg_try_advisory_lock(1791,20261124) AS locked');
  if(!lock.rows[0]?.locked)return;
  const result=await runTaskSamples((sql,params)=>client.query(sql,params));
  // Never print the drafts, source records or provider responses in public CI.
  console.log('Lab private samples: '+result.count+'/5; '+result.status+'; '+result.attempted+' topics attempted.');
 }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(()=>{console.error('Lab private sample run stopped. Check protected configuration and review page. No post or email was sent.');process.exitCode=1;});
