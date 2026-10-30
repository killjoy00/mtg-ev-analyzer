// Synthetic fixtures only. The caller owns a disposable database transaction.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import modelVersions from '../../model-versions.json' with {type:'json'};
import {corpusMembership} from '../../worker/corpus-components.mjs';
import {CORPUS_GATE_VERSION} from '../../corpus-quality.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../../draft-run-difficulty.mjs';
import {SERVING_POLICY_VERSION} from '../../serving-quality.mjs';

export async function verifyV6Cutover(query) {
  const previous=modelVersions.v5.corpus_version,target=modelVersions.v6.corpus_version;
  const key=[previous,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION];
  // Execute the actual release compare-and-swap, not a test copy of its SQL.
  const source=fs.readFileSync(new URL('../../scripts/v6-corpus-cutover.mjs',import.meta.url),'utf8');
  const statements=[...source.matchAll(/const result=\(await query\(`([\s\S]*?)`,/g)].map(m=>m[1]);
  assert.equal(statements.length,2,'The release must expose activation and rollback statements');
  const [activate,rollback]=statements;
  const set='ktk',old='fixture-v6-old',next='fixture-v6-next',stale='fixture-v6-stale';
  const mapping=JSON.stringify([{set_id:set,previous_snapshot_id:old,target_snapshot_id:next}]);
  const build=async parent=>(await query("SELECT pack1_build_serving_snapshot($1,$2,$3)->>'id' id",[parent,...key.slice(1)])).rows[0].id;
  const inventory=async id=>(await query('SELECT puzzle_id FROM draft_run_serving_inventory WHERE snapshot_id=$1 ORDER BY puzzle_id',[id])).rows.map(r=>r.puzzle_id);
  const matches=async id=>(await query('SELECT pack1_serving_snapshot_matches_current($1,$2,$3,$4) ok',[...key,id])).rows[0].ok;
  const workerRows=async parent=>(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r USING(puzzle_id)
    WHERE ${corpusMembership({serving:true})} AND p.interesting AND p.pack_number=1
      AND r.difficulty_version=$2 AND r.target_support_ratio>=0.20526315789473684::float8
    ORDER BY p.puzzle_id`,[parent,key[1]])).rows.map(r=>r.puzzle_id);
  // Flush the deferred outbox at each simulated commit, then allow a fresh
  // transaction-local revision bump while retaining the outer rollback guard.
  const boundary=async()=>{
    await query('SET CONSTRAINTS serving_readiness_outbox IMMEDIATE');
    await query('SET CONSTRAINTS serving_readiness_outbox DEFERRED');
    await query("SELECT set_config('pack1.serving_input_xid','',true)");
  };
  for(const [id,version,status] of [[old,previous,'Approved'],[next,target,'Candidate'],[stale,previous,'Superseded']]) {
    await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,
      schema_version,importer_identity,model_identity,manifest,lifecycle_status)
      VALUES($1,$2,'PremierDraft',$3,'premier-modern-skill-buckets-v1','fixture','fixture','{}',$4)`,[id,set,version,status]);
  }
  await query('UPDATE draft_run_verified_puzzles SET source_snapshot_id=$1 WHERE set_id=$2 AND corpus_version=$3',[old,set,previous]);
  await query("UPDATE draft_run_environment_policy SET active_snapshot_id=$1,status='Live' WHERE set_id=$2",[old,set]);
  await query(`INSERT INTO corpus_set_versions(set_id,corpus_version,manifest) VALUES($1,$2,'{}')`,[set,target]);
  const template=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
    WHERE p.set_id=$1 AND p.corpus_version=$2 AND p.interesting AND p.pack_number=1
      AND r.target_support_ratio>=0.20526315789473684::float8 ORDER BY p.puzzle_id LIMIT 1`,[set,previous])).rows[0].puzzle_id;
  for(const [id,version,snapshot] of [['fixture-v6-target',target,next],['fixture-v6-stale-puzzle',previous,stale]]) {
    await query(`INSERT INTO draft_run_verified_puzzles
      SELECT (jsonb_populate_record(NULL::draft_run_verified_puzzles,to_jsonb(p)||jsonb_build_object(
        'puzzle_id',$2::text,'corpus_version',$3::text,'source_snapshot_id',$4::text,
        'payload',p.payload||jsonb_build_object('corpus_version',$3::text,'model_version',$5::text)))).*
      FROM draft_run_verified_puzzles p WHERE puzzle_id=$1`,[template,id,version,snapshot,version===target?modelVersions.v6.model_version:modelVersions.v5.model_version]);
  }
  await query(`INSERT INTO corpus_health_checks(set_id,corpus_version,manifest_hash,gate_version,ready,report,source_snapshot_id)
    VALUES($1,$2,md5('{}'::jsonb::text),$3,true,'{}',$4)`,[set,target,CORPUS_GATE_VERSION,next]);
  await boundary();
  const before=await build(previous),ids=await inventory(before);
  assert.ok(ids.includes(template)&&!ids.includes('fixture-v6-stale-puzzle')&&!ids.includes('fixture-v6-target'));
  assert.deepEqual(await workerRows(previous),ids,'Worker membership agrees with the cache before activation');
  assert.equal(await matches(before),true);
  // Establish a verified ready cache, as the already deployed runtime has.
  const registered=(await query("SELECT pack1_register_readiness_key($1,$2,$3,'serving-cache-v1') id",key)).rows[0].id;
  await query(`UPDATE draft_run_readiness_jobs SET state='ready',cache_snapshot_id=$2,
    evidence='{"inventory":{"verified":true},"day":"2026-01-01"}'
    WHERE key_id=$1 AND revision=(SELECT revision FROM draft_run_serving_revision WHERE singleton)`,[registered,before]);
  const rejected=(await query(activate,[mapping,previous,target,CORPUS_GATE_VERSION,2,'fixture','{}'])).rows[0];
  assert.equal(Number(rejected.changed),0,'An incomplete mapping must not partially activate');
  const result=(await query(activate,[mapping,previous,target,CORPUS_GATE_VERSION,1,'fixture','{}'])).rows[0];
  assert.equal(Number(result.changed),1);
  assert.equal(Number(result.superseded),1);
  await boundary();
  assert.deepEqual(await workerRows(previous),ids,'The bridge keeps exactly the old worker membership');
  assert.equal(await matches(before),true,'The bridge cache remains equivalent after cross-version activation');
  const ready=(await query(`SELECT j.state,j.cache_snapshot_id FROM draft_run_readiness_jobs j
    WHERE j.key_id=$1 AND j.revision=(SELECT revision FROM draft_run_serving_revision WHERE singleton)`,[registered])).rows[0];
  assert.equal(ready.state,'ready','Activation carries the verified old cache without a service gap');
  assert.equal(String(ready.cache_snapshot_id),String(before));
  assert.deepEqual(await inventory(await build(previous)),ids);
  assert.deepEqual(await inventory(await build(target)),['fixture-v6-target'],'The new parent serves only its new snapshot');
  assert.deepEqual(await workerRows(target),['fixture-v6-target']);
  const restored=(await query(rollback,[mapping,previous,target,1,'fixture','{}'])).rows[0];
  assert.equal(Number(restored.restored),1);
  await boundary();
  assert.deepEqual(await inventory(await build(previous)),ids,'Rollback restores the original inventory');
  assert.deepEqual(await workerRows(previous),ids);
  // A same-version replacement must not expose both old and new snapshots.
  await query('UPDATE corpus_source_snapshots SET superseded_by=$1 WHERE source_snapshot_id=$2',[old,stale]);
  assert.deepEqual(await workerRows(previous),ids,'Same-version supersession never enables the bridge');
  assert.equal(await matches(await build(previous)),true);
  console.log('PASS: cross-version activation, cache carry, exact inventory, rejected partial activation and rollback.');
}
