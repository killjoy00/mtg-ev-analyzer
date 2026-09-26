// A source snapshot is immutable, but its stored manifest comes back from jsonb
// with its keys reordered, and `seconds` only records how long one build took.
// Compare what identifies the snapshot, not the serialization or the build timer.
import {isDeepStrictEqual} from 'node:util';

const VOLATILE_IMPORT_FIELDS=['seconds'];
const parse=value=>typeof value==='string'?JSON.parse(value):value;
function identifying(manifest) {
  const fullImport={...parse(manifest)?.full_import};
  for(const key of VOLATILE_IMPORT_FIELDS)delete fullImport[key];
  return {...parse(manifest),full_import:fullImport};
}

export function sameSourceSnapshotManifest(stored,built) {
  if(!parse(stored)?.full_import||!parse(built)?.full_import)return false;
  return isDeepStrictEqual(identifying(stored),identifying(built));
}
