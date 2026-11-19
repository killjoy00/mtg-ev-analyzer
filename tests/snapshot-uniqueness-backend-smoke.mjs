// A later snapshot of a set reuses the earlier snapshot's source drafts and picks.
// Both must load; a duplicate inside one snapshot, or among snapshot-less rows, must not.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Isolated development branch required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');

const setId=`qa-uniq-${randomBytes(3).toString('hex')}`;
const snapshotA=randomBytes(32).toString('hex'),snapshotB=randomBytes(32).toString('hex');
const sourceHash=randomBytes(16).toString('hex');
const UNIQUE_INDEX='draft_run_verified_puzzles_snapshot_source_pick_uq';
const duplicate=error=>error?.pgCode==='23505'&&error?.pgConstraint===UNIQUE_INDEX;

async function insertSnapshot(id) {
 await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,schema_version,draft_sha256,game_sha256,importer_identity,model_identity,manifest,lifecycle_status)
  VALUES($1,$2,'PremierDraft',$3,'qa-snapshot-v1',$4,$5,'qa-importer','qa-model','{"fixture":true}'::jsonb,'Blocked')`,
 [id,setId,DRAFT_RUN_CORPUS_VERSION,randomBytes(32).toString('hex'),randomBytes(32).toString('hex')]);
}

async function clonePuzzle(snapshotId) {
 const template=(await query(`SELECT puzzle_id FROM draft_run_verified_puzzles
  WHERE pick_number=1 AND pack_number=1 AND interesting AND corpus_version=$1
   AND coalesce(payload->>'source_event_type','PremierDraft')='PremierDraft'
  ORDER BY puzzle_id LIMIT 1`,[DRAFT_RUN_CORPUS_VERSION])).rows[0];
 assert.ok(template?.puzzle_id,'Eligible first-pick template is required.');
 await query(`INSERT INTO draft_run_verified_puzzles
  SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,
   to_jsonb(p)||jsonb_build_object('puzzle_id',$2::text,'set_id',$3::text,'source_draft_hash',$4::text,
    'corpus_version',$5::text,'pick_number',1,'source_snapshot_id',$6::text))).*
  FROM draft_run_verified_puzzles p WHERE p.puzzle_id=$1`,
 [template.puzzle_id,randomBytes(16).toString('hex'),setId,sourceHash,DRAFT_RUN_CORPUS_VERSION,snapshotId]);
}

try {
 const index=(await query(`SELECT i.indisvalid valid,i.indisunique uniq FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=$1`,[UNIQUE_INDEX])).rows[0];
 assert.ok(index&&index.valid==='t'&&index.uniq==='t',`${UNIQUE_INDEX} must be a valid unique index`);
 assert.equal((await query("SELECT count(*)::int n FROM pg_constraint WHERE conname='draft_run_verified_puzzles_corpus_version_set_id_source_dra_key'")).rows[0].n,'0');

 await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[setId,DRAFT_RUN_CORPUS_VERSION,'{"fixture":"snapshot-uniqueness"}']);
 await insertSnapshot(snapshotA);
 await insertSnapshot(snapshotB);

 await clonePuzzle(snapshotA);
 await clonePuzzle(snapshotB);
 await assert.rejects(clonePuzzle(snapshotA),duplicate,'a snapshot must not hold the same source draft and pick twice');

 await clonePuzzle(null);
 await assert.rejects(clonePuzzle(null),duplicate,'snapshot-less rows keep the corpus-wide rule');

 assert.equal((await query('SELECT count(*)::int n FROM draft_run_verified_puzzles WHERE set_id=$1 AND source_draft_hash=$2',[setId,sourceHash])).rows[0].n,'3');
 console.log(JSON.stringify({smoke:'snapshot_uniqueness',pass:true}));
} finally {
 await query('DELETE FROM draft_run_verified_puzzles WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_source_snapshots WHERE set_id=$1',[setId]);
 await query('DELETE FROM corpus_set_versions WHERE set_id=$1',[setId]);
 await query('DELETE FROM draft_run_verified_sets WHERE set_id=$1',[setId]);
}
