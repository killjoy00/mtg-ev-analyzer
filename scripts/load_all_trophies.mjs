// node scripts/load_all_trophies.mjs CONNECTION_FILE [IMPORT_DIR] [--validate-only]
// Stream artifacts; preserve existing payloads; resume additive inserts safely.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import {createHash} from 'node:crypto';
import {validateDraftRunPuzzle, interestingDraftRunPuzzle, draftRunDifficulty, DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
const directory=process.argv[3]||'corpus/draft-run/full';
const catalog=JSON.parse(fs.readFileSync(path.join(directory,'catalog.json')));
const registry=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json'));
const allowed=new Set(registry.sets.map(s=>s.id));
if(!catalog.complete || Object.keys(catalog.errors).length || catalog.corpus_version!==DRAFT_RUN_CORPUS_VERSION) throw Error('Incomplete or incompatible import');
if(new Set(catalog.requested_sets).size!==catalog.sets.length || catalog.sets.some(s=>!catalog.requested_sets.includes(s.id)))throw Error('Set accounting mismatch');
async function hash(file) { const h=createHash('sha256'); for await(const c of fs.createReadStream(file)) h.update(c);return h.digest('hex'); }
async function* records(file) { const lines=readline.createInterface({input:fs.createReadStream(file).pipe(zlib.createGunzip()),crlfDelay:Infinity});for await(const line of lines) if(line)yield JSON.parse(line); }
function fileFor(s,key) {if(!/^[a-z0-9-]+$/.test(s.id)||path.basename(s[key])!==s[key])throw Error('Unsafe artifact path');return path.join(directory,s.id,s[key]);}
// Every file is checked before any SQL mutation, including excluded-trophy accounting.
for(const s of catalog.sets) {
  for(const key of ['puzzle_file','ledger_file'])if(await hash(fileFor(s,key))!==s[key+'_sha256'])throw Error('Checksum mismatch: '+s.id);
  let total=0, included=0, qualified=0, decisions=0, additional=0;const sources=new Map();
  for await(const d of records(fileFor(s,'ledger_file'))) {
    if(sources.has(d.draft_id)||!['included','excluded'].includes(d.status))throw Error('Duplicate or invalid trophy ledger');
    sources.set(d.draft_id,d);total++;included+=d.status==='included';qualified+=Boolean(d.qualified);decisions+=d.puzzles||0;additional+=d.additional_puzzles||0;
  }
  if(total!==s.source_trophies||included!==s.included_trophies||qualified!==s.qualified_trophies||total-included!==s.excluded_trophies||decisions!==s.total_puzzles||additional!==s.additional_puzzles)throw Error('Trophy accounting mismatch: '+s.id);
  if(s.additional_puzzles&&!allowed.has(s.id))throw Error('New environment requires catalog registration: '+s.id);
  const byHash=new Map([...sources.values()].filter(d=>d.qualified).map(d=>[d.source_draft_hash,d]));const counts=new Map();let count=0;let last='';
  for await(const p of records(fileFor(s,'puzzle_file'))) {
    if(!validateDraftRunPuzzle(p)||p.set_id!==s.id||!byHash.has(p.source_draft_hash)||p.puzzle_id<=last||[...p.candidates,...p.prior_picks].some(c=>!c.image_url?.startsWith('https://')))throw Error('Invalid puzzle: '+s.id);
    const d=byHash.get(p.source_draft_hash);
    const expected=createHash('sha256').update(`${DRAFT_RUN_CORPUS_VERSION}|${s.id}|${d.draft_id}|${p.pick_number}`).digest('hex').slice(0,32);
    if(p.puzzle_id!==expected||p.source_fingerprint!==d.source_fingerprint)throw Error('Puzzle provenance mismatch');
    last=p.puzzle_id;count++;counts.set(p.source_draft_hash,(counts.get(p.source_draft_hash)||0)+1);
  }
  if(count!==s.additional_puzzles||[...byHash].some(([h,d])=>(counts.get(h)||0)!==d.additional_puzzles))throw Error('Puzzle accounting mismatch');
  console.log(s.id,count,'additional decisions validated');
}
if(process.argv.includes('--validate-only'))process.exit(0);
const connection=fs.readFileSync(process.argv[2],'utf8').trim();const db=new URL(connection);
const endpoint=`https://api.${db.hostname.split('.').slice(1).join('.')}/sql`;
async function query(sql,params=[]) {
  for(let attempt=0;attempt<3;attempt++) {
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','Neon-Connection-String':connection},body:JSON.stringify({query:sql,params}),signal:AbortSignal.timeout(120000)});
    if(r.ok)return r.json();
    if(![429,502,503,504].includes(r.status)||attempt===2)throw Error('SQL request failed: '+r.status);
    await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
  }
}
async function batchInsert(puzzles) {
  const batch=puzzles.map(p=>({puzzle_id:p.puzzle_id,set_id:p.set_id,source_draft_hash:p.source_draft_hash,corpus_version:p.corpus_version,pick_number:p.pick_number,candidate_count:p.candidates.length,consensus_top_gap:draftRunDifficulty(p).topGap,support_entropy:draftRunDifficulty(p).entropy,interesting:interestingDraftRunPuzzle(p),payload:p}));
  const r=await query(`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(puzzle_id text,set_id text,source_draft_hash text,corpus_version text,pick_number smallint,candidate_count smallint,consensus_top_gap real,support_entropy real,interesting boolean,payload jsonb)), conflicts AS (SELECT i.puzzle_id FROM incoming i JOIN draft_run_verified_puzzles e USING(puzzle_id) WHERE e.payload IS DISTINCT FROM i.payload), added AS (INSERT INTO draft_run_verified_puzzles SELECT * FROM incoming WHERE NOT EXISTS(SELECT 1 FROM conflicts) ON CONFLICT(puzzle_id) DO NOTHING RETURNING puzzle_id) SELECT (SELECT count(*) FROM conflicts)::int conflicts,(SELECT count(*) FROM added)::int added`,[JSON.stringify(batch)]);
  if(Number(r.rows[0].conflicts))throw Error('Existing puzzle differs; no payload was overwritten');
  return Number(r.rows[0].added);
}
for(const s of catalog.sets) {
  if(!s.total_puzzles)continue;
  const existing=(await query('SELECT corpus_version FROM draft_run_verified_sets WHERE set_id=$1',[s.id])).rows[0];
  if(existing?.corpus_version!==DRAFT_RUN_CORPUS_VERSION)throw Error('Baseline environment missing: '+s.id);
  let batch=[],added=0;
  for await(const p of records(fileFor(s,'puzzle_file'))) {batch.push(p);if(batch.length===100){added+=await batchInsert(batch);batch=[];}}
  if(batch.length)added+=await batchInsert(batch);
  const actual=(await query('SELECT count(*)::int puzzles FROM draft_run_verified_puzzles WHERE set_id=$1 AND corpus_version=$2',[s.id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
  if(Number(actual.puzzles)<s.total_puzzles)throw Error('Database count below verified import: '+s.id);
  await query("UPDATE draft_run_verified_sets SET manifest=jsonb_set(manifest,'{full_import}',$2::jsonb) WHERE set_id=$1",[s.id,JSON.stringify(s)]);
  console.log(s.id,added,'inserted;',actual.puzzles,'available');
}
console.log('All verified supplements loaded; prior payloads preserved.');
