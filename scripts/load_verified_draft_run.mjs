// Usage: node scripts/load_verified_draft_run.mjs /absolute/path/to/connection
// Credentials stay outside the repo and are sent only to the selected Neon SQL endpoint.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateDraftRunPuzzle, interestingDraftRunPuzzle, draftRunDifficulty } from '../draft-run.mjs';

const connection = fs.readFileSync(process.argv[2], 'utf8').trim();
const db = new URL(connection);
const endpoint = `https://api.${db.hostname.split('.').slice(1).join('.')}/sql`;
async function query(sql,params=[]) {
  const r = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','Neon-Connection-String':connection},body:JSON.stringify({query:sql,params})});
  if(!r.ok) throw new Error(`SQL operation failed (${r.status}): ${await r.text()}`);
  return r.json();
}
if (process.argv.includes('--schema')) {
  for(const sql of fs.readFileSync('migrations/0004_draft_run_product.sql','utf8').split('-- statement')) await query(sql);
  console.log('Additive schema applied.');
}
const catalog=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
for(const set of catalog.sets) {
  const bytes=fs.readFileSync(`corpus/draft-run/${set.id}.json.gz`);
  if(createHash('sha256').update(bytes).digest('hex')!==set.sha256) throw new Error('Corpus checksum mismatch.');
  const rows=JSON.parse(zlib.gunzipSync(bytes));
  if(rows.some(p=>!validateDraftRunPuzzle(p))) throw new Error('Invalid puzzle in '+set.id);
  await query(`INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb) ON CONFLICT(set_id) DO UPDATE SET corpus_version=EXCLUDED.corpus_version,manifest=EXCLUDED.manifest`,[set.id,catalog.corpus_version,JSON.stringify(set)]);
  for(let i=0;i<rows.length;i+=75) {
    const batch=rows.slice(i,i+75).map(p=>({puzzle_id:p.puzzle_id,set_id:p.set_id,source_draft_hash:p.source_draft_hash,corpus_version:p.corpus_version,pick_number:p.pick_number,candidate_count:p.candidates.length,consensus_top_gap:draftRunDifficulty(p).topGap,support_entropy:draftRunDifficulty(p).entropy,interesting:interestingDraftRunPuzzle(p),payload:p}));
    await query(`INSERT INTO draft_run_verified_puzzles SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(puzzle_id text,set_id text,source_draft_hash text,corpus_version text,pick_number smallint,candidate_count smallint,consensus_top_gap real,support_entropy real,interesting boolean,payload jsonb) ON CONFLICT(puzzle_id) DO NOTHING`,[JSON.stringify(batch)]);
  }
  console.log(set.id,rows.length,'verified puzzles');
}
console.log('Verified corpus loaded.');
