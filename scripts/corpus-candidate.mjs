import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DAILY_SELECTION_VERSION} from '../daily-selection.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';
// No serving status exists during discovery/building. A passing report earns
// Candidate; only an authenticated administrator can subsequently make it Live.
export async function registerHealthyCandidate(query,setId,manifestHash) {
 return query(`INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version,status,release_date,set_name,source_event_type)
 SELECT v.set_id,coalesce((v.manifest->>'regular_run')::boolean,false),CASE WHEN v.set_id='powered-cube' THEN 9 ELSE 8 END,1,$4,'Candidate',s.release_date,s.set_name,s.event_type
 FROM corpus_set_versions v JOIN corpus_sources s ON s.set_id=v.set_id AND s.event_type='PremierDraft'
 JOIN LATERAL(SELECT * FROM corpus_health_checks h WHERE h.set_id=v.set_id AND h.corpus_version=v.corpus_version ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
 WHERE v.set_id=$1 AND v.corpus_version=$2 AND h.ready AND h.manifest_hash=$3 AND md5(v.manifest::text)=$3
 AND h.gate_version=$5 AND h.checked_at>now()-interval '7 days' AND s.import_status='complete' AND s.archive_available
 AND (v.set_id='powered-cube' OR s.release_date IS NOT NULL)
 ON CONFLICT(set_id) DO NOTHING RETURNING set_id,status`,[setId,DRAFT_RUN_CORPUS_VERSION,manifestHash,DAILY_SELECTION_VERSION,CORPUS_GATE_VERSION]);
}
