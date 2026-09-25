import {modelVersionForComponent,supportedComponent} from '../corpus-components.mjs';
export function corpusMembership({serving=false,parameter=1}={}) {
 const live=serving?" AND c.status='Live'":'';
 const activeSnapshot=serving?`
 AND (p.corpus_version<>${parameter} OR EXISTS(
   SELECT 1 FROM draft_run_environment_policy e
   WHERE e.set_id=p.set_id AND e.status='Live'
     AND (e.active_snapshot_id IS NULL OR e.active_snapshot_id=p.source_snapshot_id
       OR (p.source_snapshot_id IS NULL AND EXISTS(
         SELECT 1 FROM corpus_source_snapshots hs
         WHERE hs.source_snapshot_id=e.active_snapshot_id AND hs.schema_version='historical-frozen'
       )))
 ))`:'';
 // Bound the version index, enforce publication independently per set, and for
 // the parent Premier corpus expose only the environment's explicitly active
 // immutable source snapshot. Components retain their separate lifecycle.
 return `p.corpus_version IN (SELECT ${parameter} UNION SELECT c.component_version FROM corpus_components c WHERE c.parent_version=${parameter}${live})
 AND (p.corpus_version=${parameter} OR EXISTS(SELECT 1 FROM corpus_components c WHERE c.parent_version=${parameter}
   AND c.component_version=p.corpus_version AND c.set_id=p.set_id${live}))${activeSnapshot}`;
}
export async function componentBelongsTo(query,puzzle,parentVersion) {
 if(puzzle?.corpus_version===parentVersion)return true;
 if(!supportedComponent(puzzle?.corpus_version)||puzzle.model_version!==modelVersionForComponent(puzzle.corpus_version))return false;
 return Boolean((await query('SELECT 1 FROM corpus_components WHERE set_id=$1 AND parent_version=$2 AND component_version=$3',
  [puzzle.set_id,parentVersion,puzzle.corpus_version])).rows.length);
}
