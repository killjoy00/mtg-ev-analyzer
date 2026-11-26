// Manual private evaluation. Same writer/reviewer and recent-set packet
// ranking as weekly Lab; no approval, scheduling, email or Patreon actions.
import {pathToFileURL} from 'node:url';
import {articleHash} from '../worker/lab-editorial.mjs';
import {aiClient,makeArticle} from '../worker/lab-writer.mjs';
import {buildStoredCorpusReport} from '../research/pack-one-lab/stored-corpus.mjs';
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
async function main(){
 // Only the explicitly selected manual mode on the protected main workflow.
 if(process.env.PACK1_LAB_SAMPLE_MODE!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')fail('untrusted-run');
 const models={writer:process.env.PACK1_LAB_WRITER_MODEL,reviewer:process.env.PACK1_LAB_REVIEWER_MODEL};
 if(!models.writer||!models.reviewer||models.writer===models.reviewer)fail('distinct-models-required');
 const writer=aiClient({key:process.env.PACK1_LAB_AI_KEY,model:models.writer});
 const reviewer=aiClient({key:process.env.PACK1_LAB_AI_KEY,model:models.reviewer});
 const {Client}=await import('pg');
 const client=new Client({connectionString:databaseURL(process.env.PACK1_LAB_DATABASE_URL),connectionTimeoutMillis:15000});
 await client.connect();
 try{
  const result=await runSampleBatch((sql,params)=>client.query(sql,params),{writer,reviewer,models});
  // Never print the drafts, source records or provider responses in public CI.
  console.log('Lab private samples: '+result.count+'/5; '+result.status+'; '+result.attempted+' topics attempted.');
 }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(()=>{console.error('Lab private sample run stopped. Check protected configuration and review page. No post or email was sent.');process.exitCode=1;});
