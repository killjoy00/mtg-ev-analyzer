const SNAPSHOT_ID=/^[a-f0-9]{64}$/i;

// A production clone may contain a verified, newer full import instead of the
// legacy source manifest recorded in the checked-in catalog. It is current only
// when its exact verified import is bound to the active source snapshot.
export function clonedCorpusMatchesCatalog(catalog,rows) {
  if(typeof catalog?.corpus_version!=='string'||!catalog.corpus_version||
    !Array.isArray(catalog.sets)||!catalog.sets.length||!Array.isArray(rows))return false;
  return catalog.sets.every(set=>rows.some(row=>{
    if(row.set_id!==set.id||row.active_version!==catalog.corpus_version)return false;
    const original=typeof set.sha256==='string'&&SNAPSHOT_ID.test(set.sha256)&&row.checksum===set.sha256;
    const upgraded=row.import_version===catalog.corpus_version&&row.import_verified==='true'&&
      typeof row.import_snapshot==='string'&&SNAPSHOT_ID.test(row.import_snapshot)&&
      row.import_snapshot===row.active_snapshot;
    return original||upgraded;
  }));
}
