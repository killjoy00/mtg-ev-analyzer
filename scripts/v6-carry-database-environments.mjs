// Environments served from the database alone (FRA joined v9 that way) have no
// checked-in replay corpus, so load_verified_draft_run creates no v10 baseline
// row for them and the v10 trophy import refuses them. Carry each one's v9
// baseline manifest forward, without its v9 import evidence, so the v10 import
// stages it like every other environment. Serving is untouched: a v10 version
// row cannot affect serving before v10 has readiness (migration 0049).
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import modelVersions from '../model-versions.json' with {type:'json'};
import {corpusDatabase} from './neon-corpus-db.mjs';

export const PREVIOUS=modelVersions.v5.corpus_version,TARGET=modelVersions.v6.corpus_version;
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;

export function databaseOnlyEnvironments(candidate,registry) {
  const checkedIn=new Set(registry.sets.map(set=>set.id));
  return candidate.sets.map(set=>set.id).filter(id=>!checkedIn.has(id)).sort();
}

export function carriedManifest(previous,setId) {
  const {full_import,...manifest}=parse(previous)||{};
  if(manifest.id!==setId)throw Error(`${setId}: v9 baseline manifest has a different environment identity`);
  return manifest;
}

export async function carryDatabaseEnvironments(query,ids) {
  for(const id of ids) {
    const row=(await query(`SELECT v.manifest,s.corpus_version active_corpus_version
      FROM draft_run_environment_policy p
      JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
      JOIN corpus_set_versions v ON v.set_id=p.set_id AND v.corpus_version=$2
      WHERE p.set_id=$1`,[id,PREVIOUS])).rows[0];
    if(row?.active_corpus_version!==PREVIOUS)throw Error(`${id}: a database-only environment must be active on ${PREVIOUS}`);
    const manifest=carriedManifest(row.manifest,id);
    await query(`INSERT INTO corpus_set_versions(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(set_id,corpus_version) DO NOTHING`,[id,TARGET,JSON.stringify(manifest)]);
    // A resumed stage keeps the row it created, which may already hold v10 import evidence.
    const stored=(await query('SELECT manifest FROM corpus_set_versions WHERE set_id=$1 AND corpus_version=$2',[id,TARGET])).rows[0];
    if(JSON.stringify(sorted(carriedManifest(stored?.manifest,id)))!==JSON.stringify(sorted(manifest)))
      throw Error(`${id}: existing ${TARGET} baseline differs from the carried ${PREVIOUS} baseline`);
  }
  return ids;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [connection,candidateRoot='generated/v6-candidate']=process.argv.slice(2);
  if(!connection)throw Error('Usage: node scripts/v6-carry-database-environments.mjs CONNECTION CANDIDATE_ROOT');
  const candidate=JSON.parse(fs.readFileSync(path.join(candidateRoot,'v6-trophy-import/catalog.json'),'utf8'));
  const registry=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
  if(candidate.corpus_version!==TARGET||registry.corpus_version!==TARGET)throw Error(`Expected the reviewed ${TARGET} candidate and baseline`);
  const carried=await carryDatabaseEnvironments(corpusDatabase(connection),databaseOnlyEnvironments(candidate,registry));
  console.log(JSON.stringify({carried_database_only_environments:carried}));
}
