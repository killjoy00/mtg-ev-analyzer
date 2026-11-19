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
  const recovery=source.match(/const recovered=\(await query\(`([\s\S]*?)`,/)?.[1];
  assert.ok(recovery,'The release must expose its exact bridge readiness recovery');
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
  // The contract simulates the cutover moment: v9 serves every environment and
  // v10 is only staged. A fixture prepared from a v10 checkout holds its
  // checked-in rows at v10, so first return them, inside the caller's
  // disposable transaction, to the v9 state the release activates from.
  if(!(await query('SELECT 1 FROM draft_run_verified_puzzles WHERE corpus_version=$1 LIMIT 1',[previous])).rows.length) {
    // Copy the version rows, move every row that references them, then drop the originals.
    await query(`INSERT INTO corpus_set_versions SELECT (jsonb_populate_record(NULL::corpus_set_versions,
      to_jsonb(v)||jsonb_build_object('corpus_version',$1::text))).* FROM corpus_set_versions v WHERE v.corpus_version=$2`,[previous,target]);
    for(const table of ['corpus_source_exclusions','corpus_health_checks','corpus_trophy_trajectories'])
      await query(`UPDATE ${table} SET corpus_version=$1 WHERE corpus_version=$2`,[previous,target]);
    await query('UPDATE corpus_components SET parent_version=$1 WHERE parent_version=$2',[previous,target]);
    await query('DELETE FROM corpus_set_versions WHERE corpus_version=$1',[target]);
    await query('UPDATE draft_run_verified_sets SET corpus_version=$1 WHERE corpus_version=$2',[previous,target]);
    await query('UPDATE corpus_source_snapshots SET corpus_version=$1 WHERE corpus_version=$2',[previous,target]);
    await query(`UPDATE draft_run_verified_puzzles SET corpus_version=$1,
      payload=payload||jsonb_build_object('corpus_version',$1::text,'model_version',$3::text) WHERE corpus_version=$2`,
      [previous,target,modelVersions.v5.model_version]);
    assert.equal((await query('SELECT count(*)::int n FROM draft_run_verified_puzzles WHERE corpus_version=$1',[target])).rows[0].n,0,
      'Only the synthetic v10 snapshot may exist before activation');
  }
  for(const [id,version,status] of [[old,previous,'Approved'],[next,target,'Candidate'],[stale,previous,'Superseded']]) {
    await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,
      schema_version,importer_identity,model_identity,manifest,lifecycle_status)
      VALUES($1,$2,'PremierDraft',$3,'premier-modern-skill-buckets-v1','fixture','fixture','{}',$4)`,[id,set,version,status]);
  }
  // Production shape: the environment serves a first-class v9 snapshot while
  // its checked-in v9 baseline rows remain unserved beside a historical-frozen
  // v9 snapshot. Keep pick 2 as such baseline rows; the bridge must not add them.
  if(!(await query("SELECT 1 FROM corpus_source_snapshots WHERE set_id=$1 AND corpus_version=$2 AND schema_version='historical-frozen'",[set,previous])).rows.length)
    await query(`INSERT INTO corpus_source_snapshots(source_snapshot_id,set_id,event_type,corpus_version,
      schema_version,importer_identity,model_identity,manifest,lifecycle_status)
      VALUES('fixture-v6-historical',$1,'PremierDraft',$2,'historical-frozen','fixture','fixture','{}','Approved')`,[set,previous]);
  await query('UPDATE draft_run_verified_puzzles SET source_snapshot_id=$1 WHERE set_id=$2 AND corpus_version=$3 AND pick_number<>2',[old,set,previous]);
  const baselineRows=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
    WHERE p.set_id=$1 AND p.corpus_version=$2 AND p.source_snapshot_id IS NULL AND p.interesting AND p.pack_number=1
      AND r.difficulty_version=$3 AND r.target_support_ratio>=0.20526315789473684::float8`,[set,previous,key[1]])).rows.map(r=>r.puzzle_id);
  assert.ok(baselineRows.length,'The fixture keeps eligible unserved v9 baseline rows');
  await query("UPDATE draft_run_environment_policy SET active_snapshot_id=$1,status='Live' WHERE set_id=$2",[old,set]);
  await query(`INSERT INTO corpus_set_versions(set_id,corpus_version,manifest) VALUES($1,$2,'{}')`,[set,target]);
  const template=(await query(`SELECT p.puzzle_id FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
    WHERE p.set_id=$1 AND p.corpus_version=$2 AND p.source_snapshot_id=$3 AND p.interesting AND p.pack_number=1
      AND r.target_support_ratio>=0.20526315789473684::float8 ORDER BY p.puzzle_id LIMIT 1`,[set,previous,old])).rows[0].puzzle_id;
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
  assert.ok(baselineRows.every(id=>!ids.includes(id)),'Unserved baseline rows are not in the v9 cache');
  assert.deepEqual(await workerRows(previous),ids,'Worker membership agrees with the cache before activation');
  assert.equal(await matches(before),true);
  // Establish a verified ready cache, as the already deployed runtime has.
  const registered=(await query("SELECT pack1_register_readiness_key($1,$2,$3,'serving-cache-v1') id",key)).rows[0].id;
  await query(`UPDATE draft_run_readiness_jobs SET state='ready',cache_snapshot_id=$2,
    evidence='{"inventory":{"verified":true},"day":"2026-01-01"}'
    WHERE key_id=$1 AND revision=(SELECT revision FROM draft_run_serving_revision WHERE singleton)`,[registered,before]);
  const revision=async()=>(await query('SELECT revision::text r FROM draft_run_serving_revision WHERE singleton')).rows[0].r;
  const activatedFrom=await revision();
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
  // Recovery: reproduce a failed activation carry. The bridge job is queued at
  // the activation revision; the verified cache stays at the prior revision.
  const activatedTo=await revision();
  const job=async()=>(await query(`SELECT state,cache_snapshot_id::text cache FROM draft_run_readiness_jobs
    WHERE key_id=$1 AND revision=$2::bigint`,[registered,activatedTo])).rows[0];
  const failCarry=async()=>{
    await query('UPDATE draft_run_serving_snapshots SET revision=$2::bigint WHERE id=$1',[before,activatedFrom]);
    await query(`UPDATE draft_run_readiness_jobs SET state='queued',cache_snapshot_id=NULL,finished_at=NULL
      WHERE key_id=$1 AND revision=$2::bigint`,[registered,activatedTo]);
    await query(`UPDATE draft_run_readiness_jobs SET state='superseded' WHERE key_id=$1 AND revision=$2::bigint`,[registered,activatedFrom]);
  };
  const recover=async()=>(await query(recovery,[...key,'serving-cache-v1'])).rows[0];
  await failCarry();
  // A cache that no longer matches every current input is never carried.
  const dropped=(await query('DELETE FROM draft_run_serving_inventory WHERE snapshot_id=$1 AND puzzle_id=$2 RETURNING *',[before,template])).rows[0];
  assert.deepEqual(await recover(),{queued:1,eligible:0,carried:0});
  assert.equal((await job()).state,'queued','A non-equivalent cache is not carried');
  await query(`INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash)
    VALUES($1,$2,$3,$4,$5,$6)`,[before,dropped.puzzle_id,dropped.set_id,dropped.pick_number,dropped.band,dropped.source_draft_hash]);
  assert.deepEqual(await recover(),{queued:1,eligible:1,carried:1});
  assert.deepEqual(await job(),{state:'ready',cache:String(before)},'Recovery carries the exact verified bridge cache');
  assert.equal(await matches(before),true);
  assert.deepEqual(await recover(),{queued:0,eligible:0,carried:0},'Recovery is idempotent');
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
