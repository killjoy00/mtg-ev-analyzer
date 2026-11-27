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

const LEGACY_ARCHIVE_ROOT = 'https://17lands-public.s3.amazonaws.com/analysis_data/';
const CURRENT_ARCHIVE_ROOT = 'https://data.17landscapes.com/analysis_data/';

export function sameMigratedArchive(previous, url, etag, bytes) {
  // The host migration copied objects and reset their Last-Modified timestamps.
  // Require the same path, a strong object tag, and the pinned size before
  // treating an archive at the new host as the same input for scheduling.
  return previous?.url?.startsWith(LEGACY_ARCHIVE_ROOT) === true
    && url === CURRENT_ARCHIVE_ROOT + previous.url.slice(LEGACY_ARCHIVE_ROOT.length)
    && /^"[a-f0-9]{32}(?:-\d+)?"$/.test(etag)
    && etag === previous.etag
    && previous.compressed_bytes > 0
    && Number(bytes) === previous.compressed_bytes;
}
