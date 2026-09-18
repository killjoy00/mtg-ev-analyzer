// Keep a newer staged manifest separate from the manifest read by old servers.
export async function stageCorpusManifest(query,setId,version,manifest,{preserveServing=false}={}) {
  const payload=JSON.stringify(manifest);
  if(preserveServing) {
    await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb) ON CONFLICT(set_id) DO NOTHING',[setId,version,payload]);
    await query(`INSERT INTO corpus_set_versions(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(set_id,corpus_version) DO UPDATE SET manifest=corpus_set_versions.manifest || EXCLUDED.manifest,manifest_updated_at=now()`,[setId,version,payload]);
  } else {
    await query(`INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(set_id) DO UPDATE SET corpus_version=EXCLUDED.corpus_version,
      manifest=CASE WHEN draft_run_verified_sets.corpus_version=EXCLUDED.corpus_version
        THEN draft_run_verified_sets.manifest || EXCLUDED.manifest ELSE EXCLUDED.manifest END`,[setId,version,payload]);
  }
}
