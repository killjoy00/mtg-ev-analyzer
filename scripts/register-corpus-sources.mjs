// Discovery is operational metadata. New environments remain Candidate.
import fs from 'node:fs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DAILY_SELECTION_VERSION} from '../daily-selection.mjs';
const query=corpusDatabase(process.argv[2]),records=JSON.parse(fs.readFileSync('generated/corpus-operations/discovery.json')).sets;
const pending=[];
for(const s of records) {
 if(!/^[a-z0-9-]{2,40}$/.test(s.set_id)||s.event_type!=='PremierDraft')throw Error('Invalid discovered identity');
 await query(`INSERT INTO corpus_sources(set_id,event_type,set_name,release_date,archive_url,archive_available,archive_etag,archive_last_modified,last_checked_at,last_error)
 VALUES($1,$2,$3,$4::date,$5,$6::boolean,$7,$8,now(),$9) ON CONFLICT(set_id,event_type) DO UPDATE SET
 set_name=coalesce(EXCLUDED.set_name,corpus_sources.set_name),release_date=coalesce(EXCLUDED.release_date,corpus_sources.release_date),archive_url=EXCLUDED.archive_url,archive_available=EXCLUDED.archive_available,archive_etag=EXCLUDED.archive_etag,archive_last_modified=EXCLUDED.archive_last_modified,last_checked_at=now(),last_error=EXCLUDED.last_error`,[s.set_id,s.event_type,s.set_name||null,s.release_date||null,s.archive_url||null,s.archive_available,s.archive_etag||null,s.archive_last_modified||null,s.error||null]);
 if(s.error||!s.archive_available)continue;
 const existing=(await query('SELECT v.manifest,p.status FROM corpus_set_versions v LEFT JOIN draft_run_environment_policy p USING(set_id) WHERE v.set_id=$1 AND v.corpus_version=$2',[s.set_id,DRAFT_RUN_CORPUS_VERSION])).rows[0];
 // Existing corpus/model evidence is frozen. Source freshness does not silently
 // retrain it in place. A reviewed corpus-version change handles later archives.
 const manifest=typeof existing?.manifest==='string'?JSON.parse(existing.manifest):existing?.manifest;
 if(manifest?.full_import||manifest?.puzzles||existing?.status==='Retired')continue;
 await query(`INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
 ON CONFLICT(set_id) DO NOTHING`,[s.set_id,DRAFT_RUN_CORPUS_VERSION,JSON.stringify({id:s.set_id,name:s.set_name,discovered:true,source_event_type:s.event_type})]);
 await query(`INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version,status,release_date,set_name,source_event_type)
 VALUES($1,$2::boolean,$3::int,1,$4,'Candidate',$5::date,$6,$7) ON CONFLICT(set_id) DO NOTHING`,[s.set_id,s.regular_run,s.set_id==='powered-cube'?9:8,DAILY_SELECTION_VERSION,s.release_date||null,s.set_name,s.event_type]);
 await query("UPDATE corpus_sources SET import_status='building',last_error=NULL WHERE set_id=$1 AND event_type='PremierDraft'",[s.set_id]);
 pending.push(s.set_id);
}
fs.writeFileSync('generated/corpus-operations/pending.txt',pending.join(','));
console.log(`${pending.length} environments ready for ingestion; publication remains manual.`);
