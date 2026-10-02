import fs from 'node:fs';
import path from 'node:path';
import modelVersions from '../model-versions.json' with {type:'json'};
import {corpusDatabase} from './neon-corpus-db.mjs';

const connection=process.argv[2],action=process.argv[3],candidateRoot=process.argv[4]||'generated/v5-candidate',stateFile=process.argv[5]||'generated/v5-release-baseline.json';
if(!connection||!['capture','verify'].includes(action))throw Error('Usage: node scripts/v5-release-state.mjs CONNECTION capture|verify CANDIDATE_ROOT STATE_FILE');
const query=corpusDatabase(connection);
const catalog=JSON.parse(fs.readFileSync(candidateRoot+'/v5-trophy-import/catalog.json','utf8'));
if(catalog.corpus_version!==modelVersions.v5.corpus_version||!catalog.complete||Object.keys(catalog.errors||{}).length)throw Error('Expected the complete reviewed v9 candidate.');
const sets=catalog.sets.map(s=>s.id).sort();
const pgArray='{'+sets.map(v=>'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+'}';

async function snapshot() {
  const environment=(await query(`SELECT p.set_id,p.status,p.active_snapshot_id,
      s.corpus_version active_corpus_version,s.schema_version active_schema_version,
      s.lifecycle_status active_lifecycle_status,md5(s.manifest::text) active_manifest_hash
    FROM draft_run_environment_policy p
    LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=p.active_snapshot_id
    WHERE p.set_id=ANY($1::text[]) ORDER BY p.set_id`,[pgArray])).rows;
  if(environment.length!==sets.length)throw Error('Release candidate environments are missing from policy.');
  const state=(await query(`SELECT
    (SELECT revision::text FROM draft_run_serving_revision WHERE singleton) serving_revision,
    (SELECT count(*)::bigint::text FROM game_results) game_results_count,
    (SELECT coalesce(md5(string_agg(md5(to_jsonb(g)::text),',' ORDER BY g.id::text)),'') FROM game_results g) game_results_hash,
    (SELECT count(*)::bigint::text FROM scores) scores_count,
    (SELECT coalesce(md5(string_agg(md5(to_jsonb(s)::text),',' ORDER BY s.id::text)),'') FROM scores s) scores_hash,
    (SELECT count(*)::bigint::text FROM draft_run_sessions) sessions_count,
    (SELECT coalesce(md5(string_agg(md5(to_jsonb(s)::text),',' ORDER BY s.id::text)),'') FROM draft_run_sessions s) sessions_hash,
    (SELECT count(*)::bigint::text FROM draft_run_schedules) schedules_count,
    (SELECT coalesce(md5(string_agg(md5(to_jsonb(s)::text),',' ORDER BY s.day,s.environment)),'') FROM draft_run_schedules s) schedules_hash,
    (SELECT coalesce(md5(string_agg(v.set_id||':'||md5(v.manifest::text),',' ORDER BY v.set_id)),'')
       FROM corpus_set_versions v WHERE v.corpus_version=$2 AND v.set_id=ANY($1::text[])) v8_manifest_hash`,
    [pgArray,modelVersions.v4.corpus_version])).rows[0];
  return {captured_at:new Date().toISOString(),sets,environment,...state};
}
const comparable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='captured_at'));

if(action==='capture') {
  const value=await snapshot();
  fs.mkdirSync(path.dirname(stateFile),{recursive:true});
  fs.writeFileSync(stateFile,JSON.stringify(value,null,2)+'\n');
  console.log(JSON.stringify({captured:true,serving_revision:value.serving_revision,sets:value.sets.length,
    game_results:value.game_results_count,scores:value.scores_count,sessions:value.sessions_count,schedules:value.schedules_count}));
} else {
  const before=JSON.parse(fs.readFileSync(stateFile,'utf8')),after=await snapshot();
  if(JSON.stringify(comparable(after))!==JSON.stringify(comparable(before))) {
    const changed=Object.keys(comparable(before)).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
    throw Error('Stage changed serving pointers or retained history: '+changed.join(','));
  }
  console.log(JSON.stringify({preserved:true,serving_revision:after.serving_revision,sets:after.sets.length,
    game_results:after.game_results_count,scores:after.scores_count,sessions:after.sessions_count,schedules:after.schedules_count}));
}
