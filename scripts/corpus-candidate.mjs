import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {DAILY_SELECTION_VERSION} from '../daily-selection.mjs';
import {CORPUS_GATE_VERSION} from '../corpus-quality.mjs';

// Health promotes an immutable source snapshot to Candidate. The environment row
// is created only for a brand-new set; an already-Live environment keeps serving
// its existing active_snapshot_id until an administrator explicitly switches it.
export async function registerHealthyCandidate(query,setId,manifestHash,sourceSnapshotId=null) {
 if(sourceSnapshotId) {
  return query(`WITH healthy AS MATERIALIZED (
   SELECT s.* FROM corpus_source_snapshots s
   JOIN corpus_sources src ON src.set_id=s.set_id AND src.event_type=s.event_type
   JOIN LATERAL (
    SELECT * FROM corpus_health_checks h
    WHERE h.source_snapshot_id=s.source_snapshot_id
    ORDER BY checked_at DESC,id DESC LIMIT 1
   ) h ON true
   WHERE s.source_snapshot_id=$3 AND s.set_id=$1 AND s.corpus_version=$2
    AND s.lifecycle_status='Blocked' AND h.ready AND h.manifest_hash=$4
    AND md5(s.manifest::text)=$4 AND h.gate_version=$6
    AND h.checked_at>now()-interval '7 days'
    AND src.import_status='complete' AND src.archive_available AND src.game_archive_available
  ), promoted AS (
   UPDATE corpus_source_snapshots s SET lifecycle_status='Candidate',status_changed_at=now()
   FROM healthy h WHERE s.source_snapshot_id=h.source_snapshot_id
   RETURNING s.*
  ), environment AS (
   INSERT INTO draft_run_environment_policy(
    set_id,regular_run,maximum_pick,daily_weight,selection_version,status,
    release_date,set_name,source_event_type,active_snapshot_id
   )
   SELECT p.set_id,coalesce((p.manifest->'full_import'->>'regular_run')::boolean,false),
    CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END,1,$5,'Candidate',
    src.release_date,src.set_name,src.event_type,p.source_snapshot_id
   FROM promoted p JOIN corpus_sources src ON src.set_id=p.set_id AND src.event_type=p.event_type
   WHERE p.set_id='powered-cube' OR src.release_date IS NOT NULL
   ON CONFLICT(set_id) DO NOTHING
   RETURNING set_id,status
  )
  SELECT set_id,lifecycle_status status FROM promoted`,
  [setId,DRAFT_RUN_CORPUS_VERSION,sourceSnapshotId,manifestHash,DAILY_SELECTION_VERSION,CORPUS_GATE_VERSION]);
 }
 return query(`INSERT INTO draft_run_environment_policy(set_id,regular_run,maximum_pick,daily_weight,selection_version,status,release_date,set_name,source_event_type)
 SELECT v.set_id,coalesce((v.manifest->>'regular_run')::boolean,false),CASE WHEN v.set_id='powered-cube' THEN 9 ELSE 8 END,1,$4,'Candidate',s.release_date,s.set_name,s.event_type
 FROM corpus_set_versions v JOIN corpus_sources s ON s.set_id=v.set_id AND s.event_type='PremierDraft'
 JOIN LATERAL(SELECT * FROM corpus_health_checks h WHERE h.set_id=v.set_id AND h.corpus_version=v.corpus_version ORDER BY checked_at DESC,id DESC LIMIT 1) h ON true
 WHERE v.set_id=$1 AND v.corpus_version=$2 AND h.ready AND h.manifest_hash=$3 AND md5(v.manifest::text)=$3
 AND h.gate_version=$5 AND h.checked_at>now()-interval '7 days' AND s.import_status='complete' AND s.archive_available
 AND (v.set_id='powered-cube' OR s.release_date IS NOT NULL)
 ON CONFLICT(set_id) DO NOTHING RETURNING set_id,status`,
 [setId,DRAFT_RUN_CORPUS_VERSION,manifestHash,DAILY_SELECTION_VERSION,CORPUS_GATE_VERSION]);
}
