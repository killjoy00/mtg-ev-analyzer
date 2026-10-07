// Real PostgreSQL regression, invoked only on a disposable backend-gate branch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {CREATOR_EVENT_SCHEMA_SQL,verifyCreatorEventSchema} from '../scripts/creator-event-schema.mjs';
import {retryRolledBackQuery} from '../worker/database-retry.mjs';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
const connection=fs.readFileSync(process.argv[2],'utf8').trim();
const args=[connection,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const players=[],children=[];
function sql(text,{check=true}={}) {
  const result=spawnSync('psql',args,{input:text,encoding:'utf8'});
  if(check&&result.status!==0)throw Error(result.stderr.trim());
  return {code:result.status,stdout:result.stdout.trim(),stderr:result.stderr};
}
function processSql(text,name) {
  const child=spawn('psql',args,{env:{...process.env,PGAPPNAME:name}});
  children.push(child);let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
  const done=new Promise(resolve=>child.once('exit',code=>resolve({code,stdout,stderr})));
  child.stdin.end(text);return {child,done};
}
function session(name) {
  const child=spawn('psql',args,{env:{...process.env,PGAPPNAME:name}});
  children.push(child);let stderr='';child.stderr.on('data',x=>stderr+=x);
  const reader=createInterface({input:child.stdout});
  return {child,send:async text=>{
    const marker=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(Error('PostgreSQL session timeout'));},15000);
      const line=x=>{if(x===marker){cleanup();resolve();}};
      const exit=()=>{cleanup();reject(Error(stderr));};
      const cleanup=()=>{clearTimeout(timer);reader.off('line',line);child.off('exit',exit);};
      reader.on('line',line);child.once('exit',exit);
      child.stdin.write(text+`\nSELECT '${marker}';\n`);
    });
  }};
}
async function waitFor(predicate) {
  for(let i=0;i<100;i++) {
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('PostgreSQL contention fixture did not reach its barrier');
}
function player() {
  const id=randomUUID();players.push(id);
  sql(`INSERT INTO players(id,display_name) VALUES('${id}','QA event fixture');`);return id;
}
const props=(key,campaign='fixture')=>`jsonb_build_object('creator_challenge_id','${key}','campaign','${campaign}')`;
const insert=(player,key,campaign='fixture',at='now()')=>`INSERT INTO analytics_events(player_id,event_name,event_props,created_at) VALUES('${player}','acquisition_touch',${props(key,campaign)},${at});`;
const count=(player,key)=>Number(sql(`SELECT count(*) FROM analytics_events WHERE player_id='${player}' AND event_name='acquisition_touch' AND event_props->>'creator_challenge_id'='${key}';`).stdout);
const schemaQuery=async query=>({rows:[JSON.parse(sql(`SELECT row_to_json(checks) FROM (${query}) checks;`).stdout)]});

try {
  // Rollout suite deliberately installs 0054 while an old body is alive. The
  // whole upgrade must be present again before all current-schema assertions.
  sql(fs.readFileSync('migrations/0055_creator_event_write_safety.sql','utf8'));
  await verifyCreatorEventSchema(schemaQuery);

  const p=player(),key=randomUUID();
  const results=await Promise.all(Array.from({length:8},(_,i)=>processSql(insert(p,key),'qa-insert-'+i).done));
  assert.ok(results.every(r=>r.code===0),JSON.stringify(results));assert.equal(count(p,key),1);

  for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
    const rejected=sql(`BEGIN ISOLATION LEVEL ${isolation}; SELECT count(*) FROM analytics_events; ${insert(p,randomUUID())} COMMIT;`,{check:false});
    assert.notEqual(rejected.code,0);assert.match(rejected.stderr,/25001/);
    assert.match(rejected.stderr,/Read Committed isolation/);
  }

  const earliestKey=randomUUID();
  sql(insert(p,earliestKey,'later',"now()-interval '1 minute'"));
  sql(insert(p,earliestKey,'earliest',"now()-interval '2 minutes'"));
  assert.equal(count(p,earliestKey),1);
  assert.equal(sql(`SELECT event_props->>'campaign' FROM analytics_events WHERE player_id='${p}' AND event_props->>'creator_challenge_id'='${earliestKey}';`).stdout,'earliest');

  // A write arriving after the merge's analytics UPDATE cannot commit an event
  // that the later player deletion anonymizes through ON DELETE SET NULL.
  const lateSource=player(),lateTarget=player(),lateKey=randomUUID();
  const mergeName='qa-late-merge-'+randomUUID(),writerName='qa-late-writer-'+randomUUID();
  sql(insert(lateSource,randomUUID()));
  sql(`CREATE FUNCTION qa_pause_analytics_merge() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF current_setting('application_name')='${mergeName}' THEN PERFORM pg_advisory_xact_lock(91550055); END IF; RETURN NULL; END; $$;
    CREATE TRIGGER zz_qa_pause_analytics_merge AFTER UPDATE ON analytics_events
      FOR EACH STATEMENT EXECUTE FUNCTION qa_pause_analytics_merge();`);
  const barrier=session('qa-late-merge-barrier');
  await barrier.send('BEGIN; SELECT pg_advisory_xact_lock(91550055);');
  const merging=processSql(`SELECT merge_pack1_player('${lateSource}','${lateTarget}');`,mergeName);
  await waitFor(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${mergeName}' AND wait_event='advisory');`).stdout==='t');
  const writing=processSql(insert(lateSource,lateKey),writerName);
  await waitFor(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${writerName}' AND wait_event='advisory');`).stdout==='t');
  await barrier.send('COMMIT;');
  const [mergeResult,writerResult]=await Promise.all([merging.done,writing.done]);
  assert.equal(mergeResult.code,0,mergeResult.stderr);
  assert.notEqual(writerResult.code,0);assert.match(writerResult.stderr,/23503/,'late source write fails after identity deletion');
  assert.equal(sql(`SELECT count(*) FROM analytics_events WHERE event_props->>'creator_challenge_id'='${lateKey}';`).stdout,'0','no orphaned attribution commits');
  sql('DROP TRIGGER zz_qa_pause_analytics_merge ON analytics_events; DROP FUNCTION qa_pause_analytics_merge();');

  // Exact former deadlock: hold a target tuple, move an earlier source onto
  // it, then update the held target tuple. The target UPDATE must roll back
  // immediately with 40001, allowing the move to finish; no 40P01 wait cycle.
  const source=player(),target=player(),cycleKey=randomUUID();
  sql(insert(source,cycleKey,'source',"now()-interval '2 minutes'")+insert(target,cycleKey,'target',"now()-interval '1 minute'"));
  const holder=session('qa-tuple-holder');
  await holder.send(`BEGIN; SELECT id FROM analytics_events WHERE player_id='${target}' FOR UPDATE;`);
  const moveName='qa-event-move-'+randomUUID();
  const move=processSql(`UPDATE analytics_events SET player_id='${target}' WHERE player_id='${source}';`,moveName);
  await waitFor(()=>sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${moveName}' AND wait_event='transactionid');`).stdout==='t');
  await assert.rejects(holder.send(`UPDATE analytics_events SET player_id=player_id WHERE player_id='${target}';`),/40001/);
  const moved=await move.done;assert.equal(moved.code,0,moved.stderr);assert.equal(count(target,cycleKey),1);
  await retryRolledBackQuery(async()=>{
    const r=sql(`UPDATE analytics_events SET player_id=player_id WHERE player_id='${target}';`,{check:false});
    if(r.code)throw Object.assign(Error(r.stderr),{pgCode:r.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1]});
  });

  // Enabled and bound to the correct function is insufficient: AFTER INSERT
  // and a column-restricted UPDATE both silently weaken the invariant.
  for(const replacement of [
    `DROP TRIGGER creator_challenge_event_insert_guard ON analytics_events;
     CREATE TRIGGER creator_challenge_event_insert_guard AFTER INSERT ON analytics_events FOR EACH ROW EXECUTE FUNCTION pack1_creator_event_write_guard();`,
    `DROP TRIGGER creator_challenge_event_update_guard ON analytics_events;
     CREATE TRIGGER creator_challenge_event_update_guard BEFORE UPDATE OF player_id ON analytics_events FOR EACH ROW EXECUTE FUNCTION pack1_creator_event_write_guard();`,
    `ALTER TABLE analytics_events DISABLE TRIGGER creator_challenge_event_insert_guard;`,
    `DROP INDEX analytics_creator_challenge_event_lookup_idx;
     CREATE INDEX analytics_creator_challenge_event_lookup_idx ON analytics_events(player_id,event_name,(event_props->>'creator_challenge_id'),created_at,id) WHERE event_props ? 'creator_challenge_id' AND false;`,
  ]) {
    const result=sql(`BEGIN; ${replacement} SELECT row_to_json(checks) FROM (${CREATOR_EVENT_SCHEMA_SQL}) checks; ROLLBACK;`);
    const checks=JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{')));
    await assert.rejects(verifyCreatorEventSchema(async()=>({rows:[checks]})),/Missing release schema prerequisite/);
  }
  await verifyCreatorEventSchema(schemaQuery);

  // Actual lookup eligibility, not a source-string assertion.
  const plan=sql(`SET enable_seqscan=off; EXPLAIN SELECT 1 FROM analytics_events existing
    WHERE existing.player_id='${p}' AND existing.event_name='acquisition_touch'
      AND existing.event_name IN ('creator_challenge_open','acquisition_touch')
      AND existing.event_props ? 'creator_challenge_id'
      AND existing.event_props->>'creator_challenge_id'='${key}';`).stdout;
  assert.match(plan,/analytics_creator_challenge_event_lookup_idx/);
  console.log('PASS: creator write isolation, concurrent inserts, earliest attribution, update lock inversion, schema definitions and lookup plan.');
} finally {
  for(const child of children)child.kill('SIGTERM');
  sql('DROP TRIGGER IF EXISTS zz_qa_pause_analytics_merge ON analytics_events; DROP FUNCTION IF EXISTS qa_pause_analytics_merge();');
  if(players.length)sql(`DELETE FROM analytics_events WHERE player_id IN (${players.map(x=>`'${x}'`).join(',')}); DELETE FROM players WHERE id IN (${players.map(x=>`'${x}'`).join(',')});`);
}
