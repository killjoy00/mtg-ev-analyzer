// Reviewed release orchestration only. Runtime bundles and source bytes are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {registerHealthyCandidate} from '../scripts/corpus-candidate.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';

export function pinnedGameSources(catalog,baseline) {
 assert.equal(catalog.corpus_version,'elite-trophy-colour-stage-v9');
 assert.equal(catalog.complete,true);
 assert.deepEqual(catalog.errors,{});
 assert.equal(catalog.sets.length,30);
 assert.equal(new Set(catalog.sets.map(s=>s.id)).size,30);
 assert.deepEqual(catalog.sets.map(s=>s.id).sort(),baseline.sets);
 const previous=new Map(baseline.environment.map(s=>[s.set_id,s]));
 return catalog.sets.map(s=>{
  const game=s.skill_source,draft=s.source_archive,old=previous.get(s.id);
  assert.match(s.source_snapshot_id,/^[a-f0-9]{64}$/);
  assert.equal(s.model_version,'strong-player-colour-stage-v5');
  assert.match(game?.sha256||'',/^[a-f0-9]{64}$/);
  assert.match(draft?.sha256||'',/^[a-f0-9]{64}$/);
  assert.match(game.etag,/^"[a-f0-9]{32}(?:-\d+)?"$/);
  assert.ok(Number.isSafeInteger(game.compressed_bytes)&&game.compressed_bytes>0);
  assert.ok(Number.isFinite(Date.parse(game.last_modified)));
  const name=s.id==='powered-cube'?'Cube_-_Powered':s.id.toUpperCase();
  assert.equal(game.url,`https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.${name}.PremierDraft.csv.gz`);
  assert.equal(old?.active_corpus_version,'elite-trophy-colour-stage-v8');
  assert.ok(old.active_snapshot_id&&old.active_manifest_hash);
  return {set_id:s.id,source_snapshot_id:s.source_snapshot_id,previous_snapshot_id:old.active_snapshot_id,
   previous_manifest_hash:old.active_manifest_hash,draft_sha256:draft.sha256,game_sha256:game.sha256,
   game_url:game.url,game_etag:game.etag,game_last_modified:game.last_modified,
   compressed_bytes:game.compressed_bytes,input_signature:s.input_signature,puzzle_file_sha256:s.puzzle_file_sha256};
 });
}

export async function verifyPinnedGameHeader(pin,fetcher=fetch) {
 const response=await fetcher(pin.game_url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,`${pin.set_id}: pinned game archive is unavailable`);
 assert.equal(response.headers.get('etag'),pin.game_etag,`${pin.set_id}: game archive changed`);
 assert.equal(Number(response.headers.get('content-length')),pin.compressed_bytes,`${pin.set_id}: game archive length changed`);
 assert.equal(Date.parse(response.headers.get('last-modified')),Date.parse(pin.game_last_modified),`${pin.set_id}: game archive date changed`);
 return {set_id:pin.set_id,url:pin.game_url,etag:pin.game_etag,last_modified:pin.game_last_modified,
  compressed_bytes:pin.compressed_bytes,sha256:pin.game_sha256,method:'HEAD'};
}

// The caller first verifies every header. The all-set guard rejects changed
// serving parents, source pins, failed/stale health, and explicit unavailability.
export const REPAIR_SQL=`WITH requested AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(set_id text,source_snapshot_id text,
 previous_snapshot_id text,previous_manifest_hash text,draft_sha256 text,game_sha256 text,
 game_url text,game_etag text,game_last_modified text,compressed_bytes bigint,
 input_signature text,puzzle_file_sha256 text)
), eligible AS MATERIALIZED (
 SELECT x.*,src.game_archive_available,md5(s.manifest::text) manifest_hash
 FROM requested x
 JOIN corpus_source_snapshots s ON s.source_snapshot_id=x.source_snapshot_id AND s.set_id=x.set_id
 JOIN draft_run_environment_policy p ON p.set_id=x.set_id AND p.active_snapshot_id=x.previous_snapshot_id
 JOIN corpus_source_snapshots old ON old.source_snapshot_id=x.previous_snapshot_id
 JOIN corpus_sources src ON src.set_id=x.set_id AND src.event_type=s.event_type
 JOIN LATERAL (SELECT * FROM corpus_health_checks h WHERE h.source_snapshot_id=s.source_snapshot_id
  ORDER BY h.checked_at DESC,h.id DESC LIMIT 1) h ON true
 WHERE s.corpus_version='elite-trophy-colour-stage-v9' AND s.lifecycle_status IN ('Blocked','Candidate')
  AND s.model_identity='strong-player-colour-stage-v5' AND s.draft_sha256=x.draft_sha256
  AND s.game_sha256=x.game_sha256 AND s.game_etag=x.game_etag AND s.game_last_modified=x.game_last_modified
  AND s.manifest->'full_import'->>'input_signature'=x.input_signature
  AND s.manifest->'full_import'->>'puzzle_file_sha256'=x.puzzle_file_sha256
  AND old.corpus_version='elite-trophy-colour-stage-v8' AND md5(old.manifest::text)=x.previous_manifest_hash
  AND old.lifecycle_status IN ('Approved','Candidate') AND p.status IN ('Live','Candidate')
  AND h.ready AND h.gate_version=$2 AND h.manifest_hash=md5(s.manifest::text)
  AND h.checked_at>now()-interval '7 days'
  AND src.import_status='complete' AND src.archive_available
  AND src.game_archive_available IS DISTINCT FROM false
  AND (src.game_archive_url IS NULL OR src.game_archive_url=x.game_url)
  AND (src.game_archive_etag IS NULL OR src.game_archive_etag=x.game_etag)
  AND (src.game_archive_last_modified IS NULL OR src.game_archive_last_modified=x.game_last_modified)
), guard AS (
 SELECT count(*) n FROM eligible HAVING count(*)=30 AND count(*)=(SELECT count(*) FROM requested)
), repaired AS (
 UPDATE corpus_sources src SET game_archive_url=x.game_url,game_archive_available=true,
  game_archive_etag=x.game_etag,game_archive_last_modified=x.game_last_modified
 FROM eligible x,guard g WHERE src.set_id=x.set_id AND src.event_type='PremierDraft'
  AND src.game_archive_available IS NULL
 RETURNING src.set_id
)
SELECT (SELECT count(*) FROM eligible)::int eligible,
 (SELECT count(*) FROM eligible WHERE game_archive_available IS NULL)::int expected_repairs,
 (SELECT count(*) FROM repaired)::int repaired,
 (SELECT jsonb_agg(jsonb_build_object('set_id',set_id,'source_snapshot_id',source_snapshot_id,'manifest_hash',manifest_hash)) FROM eligible) candidates`;

export async function repairPinnedGameMetadata(query,catalog,baseline,{fetcher=fetch,promote=registerHealthyCandidate}={}) {
 const pins=pinnedGameSources(catalog,baseline),headers=[];
 for(let i=0;i<pins.length;i+=4)headers.push(...await Promise.all(pins.slice(i,i+4).map(pin=>verifyPinnedGameHeader(pin,fetcher))));
 const result=(await query(REPAIR_SQL,[JSON.stringify(pins),CORPUS_GATE_VERSION])).rows[0];
 assert.equal(Number(result?.eligible),30,'Pinned metadata repair prerequisites changed');
 assert.equal(Number(result?.repaired),Number(result.expected_repairs),'Metadata repair must be atomic');
 const candidates=typeof result.candidates==='string'?JSON.parse(result.candidates):result.candidates;
 assert.equal(candidates?.length,30);
 for(const candidate of candidates)await promote(query,candidate.set_id,candidate.manifest_hash,candidate.source_snapshot_id);
 return {passed:true,checked_at:new Date().toISOString(),headers_checked:headers.length,repaired:Number(result.repaired),headers};
}

async function main() {
 assert.equal(process.env.TARGET,'production');
 assert.equal(process.env.ACTION,'stage');
 const [connection,catalogFile,baselineFile]=process.argv.slice(2);
 const evidence=await repairPinnedGameMetadata(corpusDatabase(connection),
  JSON.parse(fs.readFileSync(catalogFile)),JSON.parse(fs.readFileSync(baselineFile)));
 fs.writeFileSync('generated/v5-game-source-metadata.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({passed:evidence.passed,headers_checked:evidence.headers_checked,repaired:evidence.repaired}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
