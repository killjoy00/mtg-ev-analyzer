// node scripts/load_all_trophies.mjs CONNECTION_FILE [IMPORT_DIR] [--validate-only]
// Stream artifacts; preserve existing payloads; resume additive inserts safely.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {validateDraftRunPuzzle, interestingDraftRunPuzzle, draftRunDifficulty, DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {refreshServingStatistics} from '../worker/serving-statistics.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
const directory=process.argv[3]||'generated/trophy-import';
const catalog=JSON.parse(fs.readFileSync(path.join(directory,'catalog.json')));
const registry=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json'));
const policy=JSON.parse(fs.readFileSync('data/selection-policy.json'));
const supported=s=>!policy.retired_set_fingerprints.includes(createHash('sha256').update(String(s).toLowerCase()).digest('hex'));
if(catalog.requested_sets.some(s=>!supported(s))||catalog.sets.some(s=>!supported(s.id)))throw Error('Import contains a permanently retired environment');
const allowed=new Set(registry.sets.map(s=>s.id));
if(!catalog.complete || Object.keys(catalog.errors).length || catalog.corpus_version!==DRAFT_RUN_CORPUS_VERSION) throw Error('Incomplete or incompatible import');
if(catalog.sets.some(s=>s.model_version!==registry.model_version))throw Error('Import and baseline model versions differ');
if(new Set(catalog.requested_sets).size!==catalog.sets.length || catalog.sets.some(s=>!catalog.requested_sets.includes(s.id)))throw Error('Set accounting mismatch');
async function hash(file) { const h=createHash('sha256'); for await(const c of fs.createReadStream(file)) h.update(c);return h.digest('hex'); }
async function* records(file) { const lines=readline.createInterface({input:fs.createReadStream(file).pipe(zlib.createGunzip()),crlfDelay:Infinity});for await(const line of lines) if(line)yield JSON.parse(line); }
function fileFor(s,key) {if(!/^[a-z0-9-]+$/.test(s.id)||path.basename(s[key])!==s[key])throw Error('Unsafe artifact path');return path.join(directory,s.id,s[key]);}
// Every file is checked before any SQL mutation, including excluded-trophy accounting.
for(const s of catalog.sets) {
  if(!/^[a-f0-9]{64}$/.test(s.source_snapshot_id||'')||!/^premier-(modern-skill-buckets|historical-arena-rank)-v1$/.test(s.schema_version||''))throw Error('Missing or invalid source snapshot identity: '+s.id);
  for(const key of ['puzzle_file','ledger_file'])if(await hash(fileFor(s,key))!==s[key+'_sha256'])throw Error('Checksum mismatch: '+s.id);
  let total=0, included=0, qualified=0, decisions=0, additional=0;const sources=new Map();
  for await(const d of records(fileFor(s,'ledger_file'))) {
    if(sources.has(d.draft_id)||!['included','excluded'].includes(d.status))throw Error('Duplicate or invalid trophy ledger');
    sources.set(d.draft_id,d);total++;included+=d.status==='included';qualified+=Boolean(d.qualified);decisions+=d.puzzles||0;additional+=d.additional_puzzles||0;
  }
  if(total!==s.source_trophies||included!==s.included_trophies||qualified!==s.qualified_trophies||total-included!==s.excluded_trophies||decisions!==s.total_puzzles||additional!==s.additional_puzzles)throw Error('Trophy accounting mismatch: '+s.id);
  const byHash=new Map([...sources.values()].filter(d=>d.qualified).map(d=>[d.source_draft_hash,d]));const counts=new Map();let count=0;let last='';
  for await(const p of records(fileFor(s,'puzzle_file'))) {
    if(!validateDraftRunPuzzle(p)||p.set_id!==s.id||!byHash.has(p.source_draft_hash)||p.puzzle_id<=last||[...p.candidates,...p.prior_picks].some(c=>!c.image_url?.startsWith('https://')))throw Error('Invalid puzzle: '+s.id);
    const d=byHash.get(p.source_draft_hash);
    const expected=createHash('sha256').update(`${DRAFT_RUN_CORPUS_VERSION}|${s.source_snapshot_id}|${s.id}|${d.draft_id}|${p.pick_number}`).digest('hex').slice(0,32);
    if(p.puzzle_id!==expected||p.source_snapshot_id!==s.source_snapshot_id||p.source_fingerprint!==d.source_fingerprint)throw Error('Puzzle provenance mismatch');
    last=p.puzzle_id;count++;counts.set(p.source_draft_hash,(counts.get(p.source_draft_hash)||0)+1);
  }
  if(count!==s.additional_puzzles||[...byHash].some(([h,d])=>(counts.get(h)||0)!==d.additional_puzzles))throw Error('Puzzle accounting mismatch');
  console.log(s.id,count,'additional decisions validated');
}
if(process.argv.includes('--validate-only'))process.exit(0);
const remote=process.argv[2]?.startsWith('https://')?process.argv[2]:null;
const {importRequest}=await import('./actions-import-auth.mjs');
const query=remote?null:corpusDatabase(process.argv[2]);
const stageOnly=process.argv.includes('--stage-only');
if(stageOnly&&remote)throw Error('Stage-only requires the direct reviewed database loader.');
async function batchInsert(puzzles,sourceSnapshotId) {
  if(remote)return Number((await importRequest(remote,{action:'batch',puzzles,sourceSnapshotId})).added);
  const {insertTrophyBatch}=await import('../worker/trophy-import.mjs');
  return insertTrophyBatch(query,puzzles,{sourceSnapshotId});
}
async function loadSet(s) {
  if(!s.total_puzzles)return;
  const existing=remote?await importRequest(remote,{action:'status',setId:s.id}):(await query('SELECT corpus_version FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[s.id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
  if(existing?.corpus_version!==DRAFT_RUN_CORPUS_VERSION)throw Error('Baseline environment missing: '+s.id);
  if(!remote)await query(`INSERT INTO corpus_source_snapshots(
    source_snapshot_id,set_id,event_type,corpus_version,schema_version,draft_sha256,game_sha256,draft_etag,game_etag,
    draft_last_modified,game_last_modified,importer_identity,model_identity,manifest,lifecycle_status)
    VALUES($1,$2,'PremierDraft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'Blocked')
    ON CONFLICT(source_snapshot_id) DO UPDATE SET manifest=EXCLUDED.manifest`,
    [s.source_snapshot_id,s.id,DRAFT_RUN_CORPUS_VERSION,s.schema_version,s.source_archive.sha256,s.skill_source.sha256,
     s.source_archive.etag||null,s.skill_source.etag||null,s.source_archive.last_modified||null,s.skill_source.last_modified||null,
     s.import_version,s.model_version,JSON.stringify(s)]);
  let batch=[],added=0;
  for await(const p of records(fileFor(s,'puzzle_file'))) {batch.push(p);if(batch.length===250){added+=await batchInsert(batch,s.source_snapshot_id);batch=[];}}
  if(batch.length)added+=await batchInsert(batch,s.source_snapshot_id);
  const actual=remote?await importRequest(remote,{action:'finish-set',manifest:s}):(await query('SELECT count(*)::int puzzles FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2 AND source_snapshot_id=$3',[s.id,DRAFT_RUN_CORPUS_VERSION,s.source_snapshot_id])).rows[0];
  if(Number(actual.puzzles)!==s.total_puzzles)throw Error('Database count does not match verified import: '+s.id);
  if(!remote){
    let ledgerBatch=[];
    const save=async()=>{if(!ledgerBatch.length)return;await query(`INSERT INTO corpus_source_snapshot_trajectories(source_snapshot_id,source_draft_hash,event_type,wins,losses,qualified,included,puzzle_count,exclusion_reason) SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(source_draft_hash text,event_type text,wins smallint,losses smallint,qualified boolean,included boolean,puzzle_count integer,exclusion_reason text) ON CONFLICT(source_snapshot_id,source_draft_hash) DO UPDATE SET losses=EXCLUDED.losses,qualified=EXCLUDED.qualified,included=EXCLUDED.included,puzzle_count=EXCLUDED.puzzle_count,exclusion_reason=EXCLUDED.exclusion_reason`,[s.source_snapshot_id,JSON.stringify(ledgerBatch)]);ledgerBatch=[];};
    for await(const d of records(fileFor(s,'ledger_file'))){ledgerBatch.push({source_draft_hash:d.source_draft_hash||createHash('sha256').update(`${s.id}|${d.draft_id}`).digest('hex').slice(0,32),event_type:'PremierDraft',wins:d.wins??7,losses:d.losses??null,qualified:d.qualified,included:d.status==='included',puzzle_count:d.puzzles||0,exclusion_reason:d.reason||d.trajectory_limit||null});if(ledgerBatch.length===1000)await save();}await save();
    if(stageOnly)await query("UPDATE corpus_set_versions SET manifest=jsonb_set(manifest,'{full_import}',$3::jsonb),manifest_updated_at=now(),last_successful_import=now() WHERE set_id=$1 AND corpus_version=$2",[s.id,DRAFT_RUN_CORPUS_VERSION,JSON.stringify(s)]);
    else await query("UPDATE draft_run_verified_sets SET manifest=jsonb_set(manifest,'{full_import}',$2::jsonb) WHERE set_id=$1",[s.id,JSON.stringify(s)]);
    await query("UPDATE corpus_sources SET import_status='complete',last_error=NULL WHERE set_id=$1 AND event_type='PremierDraft'",[s.id]);
  }
  console.log(s.id,added,'inserted;',actual.puzzles,'available');
}
let next=0;
await Promise.all(Array.from({length:4},async()=>{while(next<catalog.sets.length)await loadSet(catalog.sets[next++]);}));
if(remote)await importRequest(remote,{action:'refresh-statistics'});
else await refreshServingStatistics(query);
console.log('All verified supplements loaded; prior payloads preserved; serving statistics refreshed.');
