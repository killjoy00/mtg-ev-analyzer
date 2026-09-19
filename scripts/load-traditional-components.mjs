// Import reviewed research artifacts as independently gated Candidates only.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {DRAFT_RUN_CORPUS_VERSION as parent,validateDraftRunPuzzle,interestingDraftRunPuzzle} from '../draft-run.mjs';
import {TRADITIONAL_COMPONENT_VERSION,TRADITIONAL_PHASE2_COMPONENT_VERSION,CUBE_TRADITIONAL_COMPONENT_VERSION,FROZEN_CONTEXT_MODEL_VERSION as model,TRADITIONAL_GATE_VERSION as gate} from '../corpus-components.mjs';
import {insertTrophyBatch} from '../worker/trophy-import.mjs';
import {refreshServingStatistics} from '../worker/serving-statistics.mjs';
import {effectiveCardMetadata} from '../card-metadata.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const files=root=>fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]);
async function* records(file){const reader=readline.createInterface({input:fs.createReadStream(file).pipe(zlib.createGunzip()),crlfDelay:Infinity});for await(const line of reader)if(line.trim())yield JSON.parse(line);}
const PHASE2_SCOPE=['hob','msh','sos','eoe','fin','tdm','dft','fdn','dsk','blb','mh3','otj','mkm','ktk','lci','woe','ltr','mom','one','bro','dmu','snc','neo','hbg','sir','pio','powered-cube'];
const sameSet=(a,b)=>[...a].sort().join(',')===[...b].sort().join(',');
const expansionSupported=report=>report.expansion_supported===true||report.automatic_expansion_supported===true;

export function sourceQuality(report,sid,{puzzles,usable,metadataComplete,storedMetadataComplete=metadataComplete,imagesComplete}) {
 const s=report.sets[sid];if(!s)throw Error('Missing per-set evidence');
 const checks=sid==='powered-cube'?['all_picks','serving_picks','quality','snapshot']:['all_picks','late_picks','serving_picks','serving_late_picks','quality'];
 const gates=Object.fromEntries(checks.map(k=>[k,s[k]?.pass===true]));
 Object.assign(gates,{independent_expansion:expansionSupported(report)&&!report.residuals?.persistent_category_patterns?.length&&!report.persistent_category_patterns?.length,
  frozen_model_parity:s.parity_picks>=200,source_accounting:puzzles===s.quality?.usable_traditional_puzzles,
  metadata_complete:metadataComplete===puzzles,images_complete:imagesComplete===puzzles,usable_inventory:usable>=200});
 return {ready:Object.values(gates).every(Boolean),gates,usable_puzzles:usable,puzzles,
  metadata:{stored_complete_puzzles:storedMetadataComplete,resolved_complete_puzzles:metadataComplete,repaired_puzzles:metadataComplete-storedMetadataComplete},
  thresholds:report.thresholds,scoring_checks:Object.fromEntries(checks.filter(k=>k.includes('picks')).map(k=>[k,{gates:s[k].gates,intervals:s[k].intervals_traditional_minus_premier,difficulty_total_variation:s[k].difficulty_total_variation}])),
  parity_picks:s.parity_picks,premier_source_audit:s.premier_source_audit};
}
export async function validateComponents(root) {
 const all=files(root),reports=all.filter(f=>path.basename(f)==='report.json');
 if(reports.length!==1)throw Error('One complete research report required');
 const report=JSON.parse(fs.readFileSync(reports[0]));
 const cube=report.schema==='cube-p2p7-admission-v1';
 const phase2=!cube&&report.schema===2&&Array.isArray(report.passing_sets)&&Array.isArray(report.failed_sets);
 const component=cube?CUBE_TRADITIONAL_COMPONENT_VERSION:phase2?TRADITIONAL_PHASE2_COMPONENT_VERSION:TRADITIONAL_COMPONENT_VERSION;
 const expectedSets=cube?['powered-cube']:phase2?PHASE2_SCOPE:['blb','dft','fin','hob'];
 const preparedSets=phase2?PHASE2_SCOPE.filter(s=>s!=='powered-cube'):expectedSets;
 if(report.production_changed!==false||report.model_training_changed!==false)throw Error('Research report is not publication-safe');
 if(phase2) {
  if(report.regression_ok!==true||report.automatic_expansion_supported!==true||report.persistent_category_patterns?.length)throw Error('Phase 2 expansion evidence is incomplete or blocked');
  if(!sameSet([...report.passing_sets,...report.failed_sets],expectedSets)||new Set([...report.passing_sets,...report.failed_sets]).size!==expectedSets.length)throw Error('Incorrect Phase 2 environment scope');
 } else if(!sameSet(Object.keys(report.sets||{}),expectedSets))throw Error('Incorrect research report');
 const prepared=[],seen=new Set();
 for(const file of all.filter(f=>path.basename(f)==='manifest.json')) {
  const manifest=JSON.parse(fs.readFileSync(file)),sid=manifest.id,dir=path.dirname(file),s=report.sets[sid];
  if(seen.has(sid)||!expectedSets.includes(sid))throw Error('Unexpected or duplicate component artifact');
  seen.add(sid);
  // The failed full-window Cube experiment is never admitted by this regular release.
  if(phase2&&sid==='powered-cube'){if(report.passing_sets.includes(sid))throw Error('Full-window Cube is not approved');continue;}
  const summaryFile=path.join(dir,'summary.json'),summary=fs.existsSync(summaryFile)?JSON.parse(fs.readFileSync(summaryFile)):null;
  const signature=summary?.frozen_input_signature||s?.frozen_input_signature;
  if(!s||manifest.component_version!==component||manifest.model_version!==model||manifest.model_source_event!=='PremierDraft'||manifest.source_event_type!=='TradDraft'||manifest.publication_authorized!==false||!/^[a-f0-9]{64}$/.test(signature||'')||manifest.frozen_input_signature!==signature)throw Error('Invalid component identity');
  if(summary&&(summary.set!==sid||summary.model_version!==model||summary.model_training_changed!==false||summary.frozen_input_signature!==manifest.frozen_input_signature))throw Error('Invalid per-set Phase 2 evidence');
  if(!manifest.source_archive?.url?.endsWith(`/draft_data_public.${cube?'Cube_-_Powered':sid.toUpperCase()}.TradDraft.csv.gz`)||!manifest.source_archive.url.startsWith('https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/'))throw Error('Invalid source archive');
  for(const name of ['puzzles','trophies'])if(hash(path.join(dir,name+'.jsonl.gz'))!==manifest[name==='puzzles'?'puzzle_file_sha256':'ledger_file_sha256'])throw Error('Component checksum mismatch');
  if(cube&&(manifest.admission_policy!=='cube-p2p7-admission-v1'||manifest.serving_window?.first_pick!==2||manifest.serving_window?.last_pick!==7||!manifest.cube_snapshot?.pass))throw Error('Unapproved Cube window');
  const width=cube?6:8;
  const ledger=new Map();let qualified=0,included=0;
  for await(const d of records(path.join(dir,'trophies.jsonl.gz'))) {
   if(!/^[a-f0-9]{32}$/.test(d.source_draft_hash)||ledger.has(d.source_draft_hash)||d.event_type!=='TradDraft'||d.wins!==3||d.losses!==0||!['included','excluded'].includes(d.status))throw Error('Invalid Traditional source ledger');
   // v1 omits `qualified` only for already-complete qualified trajectories.
   const q=d.qualified??true;qualified+=Number(q);included+=Number(d.status==='included');ledger.set(d.source_draft_hash,{...d,qualified:q});
  }
  if(ledger.size!==s.traditional_cohort.trophy_outcomes['3-0']||qualified!==s.traditional_cohort.qualified_trophies||included*width!==manifest.puzzles)throw Error('Traditional trophy accounting mismatch');
  const groups=new Map(),ids=new Set();let puzzles=0,usable=0,metadataComplete=0,storedMetadataComplete=0,imagesComplete=0;
  for await(const p of records(path.join(dir,'puzzles.jsonl.gz'))) {
   const source=ledger.get(p.source_draft_hash);
   if(!validateDraftRunPuzzle(p,component)||p.set_id!==sid||ids.has(p.puzzle_id)||source?.status!=='included'||source.source_fingerprint!==p.source_fingerprint||p.player_win_rate_bucket<s.traditional_cohort.cutoff||Math.abs(p.candidates.reduce((n,c)=>n+c.model_probability,0)-1)>.00005)throw Error('Invalid component puzzle or support evidence');
   ids.add(p.puzzle_id);const prior=groups.get(p.source_draft_hash)||(cube?p.prior_picks.slice(0,1).map(c=>c.name):[]);
   if(p.pick_number!==prior.length+1||JSON.stringify(p.prior_picks.map(c=>c.name))!==JSON.stringify(prior))throw Error('Broken Traditional trajectory');
   prior.push(p.candidates.find(c=>c.id===p.historical_pick_id).name);groups.set(p.source_draft_hash,prior);
   puzzles++;usable+=Number(interestingDraftRunPuzzle(p));
   const cards=[...p.candidates,...p.prior_picks];storedMetadataComplete+=Number(cards.every(c=>c.name&&c.rarity&&c.type_line));metadataComplete+=Number(cards.map(effectiveCardMetadata).every(c=>c.name&&c.rarity&&c.type_line));imagesComplete+=Number(cards.every(c=>c.image_url?.startsWith('https://')));
  }
  if(puzzles!==manifest.puzzles||groups.size!==included||[...groups.values()].some(p=>p.length!==(cube?7:8)))throw Error('Incomplete first-eight source accounting');
  const health=sourceQuality(report,sid,{puzzles,usable,metadataComplete,storedMetadataComplete,imagesComplete});
  if(phase2&&health.ready!==report.passing_sets.includes(sid))throw Error('Phase 2 pass status differs from reconstructed component health');
    prepared.push({sid,dir,ledger,health,manifest:{...manifest,model_source_corpus:parent,research_report_sha256:hash(reports[0]),qualified_trophies:qualified,included_trophies:included,excluded_trophies:ledger.size-included,source_trophies:ledger.size}});
 }
 if(!sameSet(seen,expectedSets)||!sameSet(prepared.map(s=>s.sid),preparedSets))throw Error('Complete reviewed component artifact set required');
 return prepared;
}
export async function importComponents(query,prepared) {
 // A later run may resume a Candidate, but may not silently replace an artifact
 // or append to Live inventory under the same revision.
 for(const s of prepared.filter(s=>s.health.ready)) {
  const component=s.manifest.component_version;
  const base=parse((await query("SELECT manifest->'full_import' AS m FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2",[s.sid,parent])).rows[0]?.m);
  if(base?.model_version!==model||base.input_signature!==s.manifest.frozen_input_signature)throw Error('Parent model evidence differs from the validated artifact');
  const current=(await query('SELECT v.manifest,c.status FROM corpus_set_versions v LEFT JOIN corpus_components c ON c.set_id=v.set_id AND c.component_version=v.corpus_version WHERE v.set_id=$1 AND v.corpus_version=$2',[s.sid,component])).rows[0];
  if(current&&(hashObject(parse(current.manifest))!==hashObject(s.manifest)||current.status!=='Candidate'))throw Error('Existing component revision is immutable or published');
 }
 for(const s of prepared) {
  const component=s.manifest.component_version;
  if(!s.health.ready) {
   await query("INSERT INTO corpus_sources(set_id,event_type,archive_url,archive_available,import_status,last_error) VALUES($1,'TradDraft',$2,true,'failed',$3) ON CONFLICT(set_id,event_type) DO UPDATE SET import_status='failed',last_error=EXCLUDED.last_error",[s.sid,s.manifest.source_archive.url,'Research quality gate blocked: '+Object.entries(s.health.gates).filter(([,v])=>!v).map(([k])=>k).join(', ')]);
   console.log(JSON.stringify({set:s.sid,status:'blocked before Candidate',gates:s.health.gates}));
   continue;
  }
  await query('INSERT INTO corpus_set_versions(set_id,corpus_version,manifest,last_successful_import) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT DO NOTHING',[s.sid,component,JSON.stringify(s.manifest)]);
  await query("INSERT INTO corpus_components(set_id,parent_version,component_version,event_type,model_version) VALUES($1,$2,$3,'TradDraft',$4) ON CONFLICT DO NOTHING",[s.sid,parent,component,model]);
  let batch=[];for await(const p of records(path.join(s.dir,'puzzles.jsonl.gz'))){batch.push(p);if(batch.length===250){await insertTrophyBatch(query,batch,{componentVersion:component});batch=[];}}if(batch.length)await insertTrophyBatch(query,batch,{componentVersion:component});
  const ledger=[...s.ledger.values()].map(d=>({source_draft_hash:d.source_draft_hash,event_type:'TradDraft',wins:3,losses:0,qualified:d.qualified,included:d.status==='included',puzzle_count:d.puzzles||0,exclusion_reason:d.reason||null}));
  for(let i=0;i<ledger.length;i+=1000)await query(`INSERT INTO corpus_trophy_trajectories(set_id,corpus_version,source_draft_hash,event_type,wins,losses,qualified,included,puzzle_count,exclusion_reason)
   SELECT $1,$2,x.* FROM jsonb_to_recordset($3::jsonb) x(source_draft_hash text,event_type text,wins smallint,losses smallint,qualified boolean,included boolean,puzzle_count integer,exclusion_reason text) ON CONFLICT DO NOTHING`,[s.sid,component,JSON.stringify(ledger.slice(i,i+1000))]);
  const counts=(await query("SELECT count(*)::int n,count(*) FILTER(WHERE interesting)::int usable,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM draft_run_puzzle_ratings r WHERE r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'))::int unrated FROM draft_run_verified_puzzles p WHERE set_id=$1 AND corpus_version=$2",[s.sid,component])).rows[0];
  if(Number(counts.n)!==s.manifest.puzzles||Number(counts.usable)!==s.health.usable_puzzles||Number(counts.unrated))throw Error('Stored Candidate health differs from verified files');
  await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report)
   SELECT set_id,corpus_version,md5(manifest::text),$3,$4::boolean,$5::jsonb FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2`,[s.sid,component,gate,s.health.ready,JSON.stringify(s.health)]);
  const a=s.manifest.source_archive;
  await query("INSERT INTO corpus_sources(set_id,event_type,archive_url,archive_available,archive_etag,archive_last_modified,import_status) VALUES($1,'TradDraft',$2,true,$3,$4,'complete') ON CONFLICT(set_id,event_type) DO UPDATE SET import_status='complete',archive_url=EXCLUDED.archive_url,archive_etag=EXCLUDED.archive_etag,archive_last_modified=EXCLUDED.archive_last_modified",[s.sid,a.url,a.etag,a.last_modified]);
  console.log(JSON.stringify({set:s.sid,status:'Candidate',ready:s.health.ready,puzzles:s.manifest.puzzles,usable:s.health.usable_puzzles}));
 }
 await refreshServingStatistics(query);
}
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
const hashObject=value=>createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
if(process.argv[1]?.endsWith('/load-traditional-components.mjs')) {
 const prepared=await validateComponents(process.argv[3]);
 if(process.argv.includes('--validate-only'))console.log(JSON.stringify(prepared.map(s=>({set:s.sid,...s.health}))));
 else await importComponents(corpusDatabase(process.argv[2]),prepared);
}
