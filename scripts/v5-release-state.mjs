import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import modelVersions from '../model-versions.json' with {type:'json'};
import {corpusDatabase} from './neon-corpus-db.mjs';

const HISTORY_SQL=Object.freeze({
  game_results: `SELECT md5((to_jsonb(t)-ARRAY['id','player_id','opponent_name','opponent_score','outcome']::text[])::text) fingerprint,count(*)::int n FROM game_results t GROUP BY 1 ORDER BY 1`,
  scores: `SELECT md5((to_jsonb(t)-ARRAY['id','player_id','is_featured']::text[])::text) fingerprint,count(*)::int n FROM scores t GROUP BY 1 ORDER BY 1`,
  draft_run_sessions: `SELECT md5((to_jsonb(t)-ARRAY['player_id','day','answers','rerolls','revision','challenge_id','score','updated_at','result_persisted_at','merged_daily_date']::text[])::text) fingerprint,count(*)::int n FROM draft_run_sessions t GROUP BY 1 ORDER BY 1`,
  draft_run_schedules: `SELECT md5(to_jsonb(t)::text) fingerprint,count(*)::int n FROM draft_run_schedules t GROUP BY 1 ORDER BY 1`,
});

export function assertHistoryPreserved(before,after) {
  for(const table of Object.keys(HISTORY_SQL)) {
    const current=new Map((after?.[table]||[]).map(row=>[row.fingerprint,Number(row.n)]));
    for(const row of before?.[table]||[]) {
      if((current.get(row.fingerprint)||0)<Number(row.n))throw Error(`Stage changed or removed pre-existing ${table} history (${row.fingerprint}).`);
    }
  }
}

async function main() {
  const connection=process.argv[2],action=process.argv[3],candidateRoot=process.argv[4]||'generated/v5-candidate',stateFile=process.argv[5]||'generated/v5-release-baseline.json';
  if(!connection||!['capture','verify'].includes(action))throw Error('Usage: node scripts/v5-release-state.mjs CONNECTION capture|verify CANDIDATE_ROOT STATE_FILE');
  const query=corpusDatabase(connection);
  const catalog=JSON.parse(fs.readFileSync(candidateRoot+'/v5-trophy-import/catalog.json','utf8'));
  if(catalog.corpus_version!==modelVersions.v5.corpus_version||!catalog.complete||Object.keys(catalog.errors||{}).length)throw Error('Expected the complete reviewed v9 candidate.');
  const sets=catalog.sets.map(s=>s.id).sort();
  const pgArray='{'+sets.map(v=>'"'+v.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"').join(',')+'}';

  async function history() {
    const result={};
    for(const [table,sql] of Object.entries(HISTORY_SQL))result[table]=(await query(sql)).rows;
    return result;
  }
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
      (SELECT coalesce(md5(string_agg(v.set_id||':'||md5(v.manifest::text),',' ORDER BY v.set_id)),'')
         FROM corpus_set_versions v WHERE v.corpus_version=$2 AND v.set_id=ANY($1::text[])) v8_manifest_hash`,
      [pgArray,modelVersions.v4.corpus_version])).rows[0];
    const preservedHistory=await history();
    return {captured_at:new Date().toISOString(),sets,environment,...state,history:preservedHistory,
      history_counts:Object.fromEntries(Object.entries(preservedHistory).map(([table,rows])=>[table,rows.reduce((n,row)=>n+Number(row.n),0)]))};
  }

  if(action==='capture') {
    const value=await snapshot();
    fs.mkdirSync(path.dirname(stateFile),{recursive:true});
    fs.writeFileSync(stateFile,JSON.stringify(value,null,2)+'\n');
    console.log(JSON.stringify({captured:true,serving_revision:value.serving_revision,sets:value.sets.length,history_counts:value.history_counts}));
  } else {
    const before=JSON.parse(fs.readFileSync(stateFile,'utf8')),after=await snapshot();
    for(const key of ['sets','environment','serving_revision','v8_manifest_hash']) {
      if(JSON.stringify(after[key])!==JSON.stringify(before[key]))throw Error('Stage changed serving/rollback state: '+key);
    }
    assertHistoryPreserved(before.history,after.history);
    console.log(JSON.stringify({preserved:true,serving_revision:after.serving_revision,sets:after.sets.length,
      before_history_counts:before.history_counts,after_history_counts:after.history_counts}));
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
