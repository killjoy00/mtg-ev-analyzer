// Capture and re-verify the v9 rollback state around a v10 stage. Shares the
// v5 release's game-history preservation rules; the rollback parent is the
// active modern v9 snapshot rather than a v8 historical-frozen one.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import modelVersions from '../model-versions.json' with {type:'json'};
import {corpusDatabase} from './neon-corpus-db.mjs';
import {HISTORY_SQL,assertHistoryPreserved as checkHistoryPreserved} from './v5-release-state.mjs';

export {HISTORY_SQL};
export function assertHistoryPreserved(before,after) {
  try {checkHistoryPreserved(before,after);}
  catch {throw Error('Release history preservation check failed.');}
}
export const ROLLBACK_SCHEMA='premier-modern-skill-buckets-v1';
const PREVIOUS=modelVersions.v5.corpus_version;

async function main() {
  const connection=process.argv[2],action=process.argv[3],candidateRoot=process.argv[4]||'generated/v6-candidate',stateFile=process.argv[5]||'generated/v6-release-baseline.json';
  if(!connection||!['capture','verify','verify-preserved'].includes(action))throw Error('Usage: node scripts/v6-release-state.mjs CONNECTION capture|verify|verify-preserved CANDIDATE_ROOT STATE_FILE');
  const query=corpusDatabase(connection);
  const catalog=JSON.parse(fs.readFileSync(candidateRoot+'/v6-trophy-import/catalog.json','utf8'));
  if(catalog.corpus_version!==modelVersions.v6.corpus_version||!catalog.complete||Object.keys(catalog.errors||{}).length||catalog.sets.length!==31)throw Error('Expected the complete reviewed v10 candidate.');
  const sets=catalog.sets.map(s=>s.id).sort();
  const pgArray='{'+sets.map(v=>'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+'}';

  async function history() {
    const result={};
    for(const [table,sql] of Object.entries(HISTORY_SQL))result[table]=(await query(sql)).rows;
    return result;
  }
  const manifestHash=async()=>(await query(`SELECT coalesce(md5(string_agg(set_id||':'||md5(manifest::text),',' ORDER BY set_id)),'') hash
    FROM corpus_set_versions WHERE corpus_version=$2 AND set_id=ANY($1::text[])`,[pgArray,PREVIOUS])).rows[0]?.hash;
  async function snapshot() {
    const environment=(await query(`SELECT p.set_id,p.status,p.active_snapshot_id,
        s.corpus_version active_corpus_version,s.schema_version active_schema_version,
        s.lifecycle_status active_lifecycle_status,md5(s.manifest::text) active_manifest_hash
      FROM draft_run_environment_policy p
      LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
      WHERE p.set_id=ANY($1::text[]) ORDER BY p.set_id`,[pgArray])).rows;
    if(environment.length!==sets.length)throw Error('Release candidate environments are missing from policy.');
    for(const row of environment) {
      if(row.active_corpus_version!==PREVIOUS||row.active_schema_version!==ROLLBACK_SCHEMA)
        throw Error(`${row.set_id}: stage requires the captured active v9 rollback parent, found ${row.active_corpus_version||'none'}/${row.active_schema_version||'none'}.`);
    }
    const serving_revision=(await query('SELECT revision::text revision FROM draft_run_serving_revision WHERE singleton')).rows[0]?.revision;
    const preservedHistory=await history();
    return {captured_at:new Date().toISOString(),sets,environment,serving_revision,v9_manifest_hash:await manifestHash(),
      history:preservedHistory,
      history_counts:Object.fromEntries(Object.entries(preservedHistory).map(([table,rows])=>[table,rows.reduce((n,row)=>n+Number(row.n),0)]))};
  }

  if(action==='verify-preserved') {
    const before=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    const environment=(await query('SELECT set_id,status FROM draft_run_environment_policy WHERE set_id=ANY($1::text[]) ORDER BY set_id',[pgArray])).rows;
    if(JSON.stringify(sets)!==JSON.stringify(before.sets)||
       JSON.stringify(environment)!==JSON.stringify(before.environment.map(({set_id,status})=>({set_id,status})))||
       await manifestHash()!==before.v9_manifest_hash)throw Error('Active acceptance changed environment policy or retained v9 manifests.');
    const after=await history();
    assertHistoryPreserved(before.history,after);
    console.log(JSON.stringify({preserved:true,sets:sets.length}));
  } else if(action==='capture') {
    const value=await snapshot();
    fs.mkdirSync(path.dirname(stateFile),{recursive:true});
    fs.writeFileSync(stateFile,JSON.stringify(value,null,2)+'\n');
    console.log(JSON.stringify({captured:true,sets:value.sets.length}));
  } else {
    const before=JSON.parse(fs.readFileSync(stateFile,'utf8')),after=await snapshot();
    for(const key of ['sets','environment','serving_revision','v9_manifest_hash']) {
      if(JSON.stringify(after[key])!==JSON.stringify(before[key]))throw Error('Stage changed serving/rollback state: '+key);
    }
    assertHistoryPreserved(before.history,after.history);
    console.log(JSON.stringify({preserved:true,sets:after.sets.length}));
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
