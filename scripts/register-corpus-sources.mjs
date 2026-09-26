// Discovery is operational metadata. Candidate is earned after complete health verification.
import fs from 'node:fs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
const query=corpusDatabase(process.argv[2]),records=JSON.parse(fs.readFileSync('generated/corpus-operations/discovery.json')).sets;
const pending=[];
for(const s of records) {
 if(!/^[a-z0-9-]{2,40}$/.test(s.set_id)||s.event_type!=='PremierDraft')throw Error('Invalid discovered identity');
 await query(`INSERT INTO corpus_sources(
 set_id,event_type,set_name,release_date,archive_url,archive_available,archive_etag,archive_last_modified,
 game_archive_url,game_archive_available,game_archive_etag,game_archive_last_modified,last_checked_at,last_error)
 VALUES($1,$2,$3,$4::date,$5,$6::boolean,$7,$8,$9,$10::boolean,$11,$12,now(),$13)
 ON CONFLICT(set_id,event_type) DO UPDATE SET
 set_name=coalesce(EXCLUDED.set_name,corpus_sources.set_name),release_date=coalesce(EXCLUDED.release_date,corpus_sources.release_date),
 archive_url=EXCLUDED.archive_url,archive_available=EXCLUDED.archive_available,archive_etag=EXCLUDED.archive_etag,archive_last_modified=EXCLUDED.archive_last_modified,
 game_archive_url=EXCLUDED.game_archive_url,game_archive_available=EXCLUDED.game_archive_available,game_archive_etag=EXCLUDED.game_archive_etag,
 game_archive_last_modified=EXCLUDED.game_archive_last_modified,last_checked_at=now(),last_error=EXCLUDED.last_error`,
 [s.set_id,s.event_type,s.set_name||null,s.release_date||null,s.archive_url||null,s.archive_available,s.archive_etag||null,s.archive_last_modified||null,
  s.game_archive_url||null,s.game_archive_available,s.game_archive_etag||null,s.game_archive_last_modified||null,s.error||null]);
 if(s.error||!s.archive_available||!s.game_archive_available)continue;
 const existing=(await query('SELECT v.manifest,p.status FROM corpus_set_versions v LEFT JOIN draft_run_environment_policy p USING(set_id) WHERE v.set_id=$1 AND v.corpus_version=$2',[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 const latest=(await query(`SELECT draft_etag,game_etag,draft_last_modified,game_last_modified
  FROM corpus_source_snapshots WHERE set_id=$1 AND corpus_version=$2 AND event_type='PremierDraft'
   AND schema_version<>'historical-frozen' ORDER BY created_at DESC LIMIT 1`,[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 const manifest=typeof existing?.manifest==='string'?JSON.parse(existing.manifest):existing?.manifest;
 if(existing?.status==='Retired')continue;
 // Existing pre-snapshot corpora stay frozen. Once a set has a first-class snapshot,
 // a changed upstream Draft/Game object is allowed to create a new immutable snapshot.
 if((manifest?.full_import||manifest?.puzzles)&&!latest)continue;
 if(latest&&latest.draft_etag===s.archive_etag&&latest.game_etag===s.game_archive_etag&&
    latest.draft_last_modified===s.archive_last_modified&&latest.game_last_modified===s.game_archive_last_modified)continue;
 await query(`INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
 ON CONFLICT(set_id) DO NOTHING`,[s.set_id,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({id:s.set_id,name:s.set_name,discovered:true,source_event_type:s.event_type,regular_run:s.regular_run,release_date:s.release_date||null})]);
 await query("UPDATE corpus_sources SET import_status='building',last_error=NULL WHERE set_id=$1 AND event_type='PremierDraft'",[s.set_id]);
 pending.push(s.set_id);
}
fs.writeFileSync('generated/corpus-operations/pending.txt',pending.join(','));
console.log(`${pending.length} environments ready for ingestion; publication remains manual.`);
