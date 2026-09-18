import {FROZEN_CONTEXT_MODEL_VERSION,supportedComponent} from '../corpus-components.mjs';
export function corpusMembership({serving=false,parameter=1}={}) {
 const live=serving?" AND c.status='Live'":'';
 // Bound the version index, then enforce publication independently per set.
 return `p.corpus_version IN (SELECT $${parameter} UNION SELECT c.component_version FROM corpus_components c WHERE c.parent_version=$${parameter}${live})
 AND (p.corpus_version=$${parameter} OR EXISTS(SELECT 1 FROM corpus_components c WHERE c.parent_version=$${parameter}
   AND c.component_version=p.corpus_version AND c.set_id=p.set_id${live}))`;
}
export async function componentBelongsTo(query,puzzle,parentVersion) {
 if(puzzle?.corpus_version===parentVersion)return true;
 if(!supportedComponent(puzzle?.corpus_version)||puzzle.model_version!==FROZEN_CONTEXT_MODEL_VERSION)return false;
 return Boolean((await query('SELECT 1 FROM corpus_components WHERE set_id=$1 AND parent_version=$2 AND component_version=$3',
  [puzzle.set_id,parentVersion,puzzle.corpus_version])).rows.length);
}
