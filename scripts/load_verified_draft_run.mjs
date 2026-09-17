// Usage: node scripts/load_verified_draft_run.mjs /absolute/path/to/connection
// Credentials stay outside the repo and are sent only to the selected Neon SQL endpoint.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateDraftRunPuzzle } from '../draft-run.mjs';
import {insertTrophyBatch} from '../worker/trophy-import.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

const query=corpusDatabase(process.argv[2]);
if (process.argv.includes('--schema')) {
  for(const sql of fs.readFileSync('migrations/0004_draft_run_product.sql','utf8').split('-- statement')) await query(sql);
  console.log('Additive schema applied.');
}
const catalog=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
const registry=JSON.parse(fs.readFileSync('data/catalog.json','utf8'));
if(JSON.stringify(catalog.sets.map(s=>s.id).sort())!==JSON.stringify(registry.sets.map(s=>s.id).sort()))throw new Error('Trophy coverage must match the complete loaded catalog.');
// Validate every artifact before making any database changes.
const prepared=catalog.sets.map(set=>{
  const bytes=fs.readFileSync(`corpus/draft-run/${set.id}.json.gz`);
  if(createHash('sha256').update(bytes).digest('hex')!==set.sha256) throw new Error('Corpus checksum mismatch.');
  const rows=JSON.parse(zlib.gunzipSync(bytes));
  if(rows.length!==set.puzzles||rows.some(p=>!validateDraftRunPuzzle(p)||p.set_id!==set.id||[...p.candidates,...p.prior_picks].some(c=>!c.image_url?.startsWith('https://')))) throw new Error('Invalid puzzle in '+set.id);
  return {set,rows};
});
async function loadSet({set,rows}) {
  await query(`INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(set_id) DO UPDATE SET corpus_version=EXCLUDED.corpus_version,
      manifest=CASE WHEN draft_run_verified_sets.corpus_version=EXCLUDED.corpus_version
        THEN draft_run_verified_sets.manifest || EXCLUDED.manifest ELSE EXCLUDED.manifest END`,
    [set.id,catalog.corpus_version,JSON.stringify({...set,model_version:catalog.model_version})]);
  for(let i=0;i<rows.length;i+=250) {
    // The same immutable insert is used for baselines and supplements. A
    // conflicting payload is an error, not an apparently successful no-op.
    await insertTrophyBatch(query,rows.slice(i,i+250));
  }
  console.log(set.id,rows.length,'verified puzzles');
}
// Independent set uploads use a bounded worker pool. Each set manifest precedes
// its own puzzle batches; reruns remain idempotent and preserve old versions.
let next=0;
await Promise.all(Array.from({length:4},async()=>{
  while(next<prepared.length)await loadSet(prepared[next++]);
}));
const actual=await query('SELECT set_id,count(*)::int puzzles FROM draft_run_verified_puzzles WHERE corpus_version=$1 GROUP BY set_id',[catalog.corpus_version]);
// A retry after supplement loading legitimately contains more than the
// baseline. Every baseline ID and its exact payload was checked above.
if(catalog.sets.some(s=>Number(actual.rows.find(r=>r.set_id===s.id)?.puzzles)<s.puzzles))throw new Error('Loaded corpus count mismatch.');
console.log('Verified corpus loaded.');
