import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
const connectionFile=process.argv[2];
const databaseUrl=fs.readFileSync(connectionFile,'utf8').trim();
if(!databaseUrl)throw Error('Missing isolated database connection.');

function runPsql({sql=null,file=null}={}) {
  const args=[databaseUrl,'-X','-v','ON_ERROR_STOP=1'];
  if(file)args.push('-f',file);
  else args.push('-c',sql);
  const result=spawnSync('psql',args,{encoding:'utf8'});
  if(result.status!==0)throw Error((result.stderr||result.stdout||'psql failed').trim());
  return String(result.stdout||'').trim();
}
function mergeFunctionSql(path) {
  const source=fs.readFileSync(path,'utf8');
  const signature='CREATE OR REPLACE FUNCTION merge_pack1_player(source_player uuid, target_player uuid)';
  const start=source.indexOf(signature),end=source.indexOf('\n$$;',start);
  assert.ok(start>=0&&end>start,'merge function missing from '+path);
  return source.slice(start,end+4);
}
async function waitFor(predicate,{attempts=100,delay=50}={}) {
  for(let i=0;i<attempts;i++) {
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,delay));
  }
  throw Error('Timed out waiting for PostgreSQL rollout fixture.');
}

const source=randomUUID(),target=randomUUID(),challenge=randomUUID();
const advisory=91540054;
let holder=null,merge=null;
try {
  // Reconstruct the pre-0054 state on this disposable branch. The old merge
  // body is deliberately installed while the new creator-event triggers are
  // removed, then an invocation is started and held before it touches analytics.
  runPsql({sql:`
    DROP TRIGGER IF EXISTS creator_challenge_event_insert_guard ON analytics_events;
    DROP TRIGGER IF EXISTS creator_challenge_event_update_guard ON analytics_events;
    DROP TRIGGER IF EXISTS creator_challenge_event_update_dedupe ON analytics_events;
    DROP FUNCTION IF EXISTS pack1_creator_event_write_guard();
    DROP FUNCTION IF EXISTS pack1_creator_event_update_dedupe();
    DROP INDEX IF EXISTS analytics_creator_challenge_event_lookup_idx;
    DROP INDEX IF EXISTS analytics_creator_challenge_event_uq;
  `});
  runPsql({sql:mergeFunctionSql('migrations/0046_public_identity_safety.sql')});
  runPsql({sql:`
    INSERT INTO players(id,display_name) VALUES
      ('${source}'::uuid,'Rollout guest'),
      ('${target}'::uuid,'Rollout account');
    INSERT INTO analytics_events(player_id,event_name,event_props,created_at) VALUES
      ('${source}'::uuid,'creator_challenge_open',
        jsonb_build_object('creator_challenge_id','${challenge}'),now()-interval '2 minutes'),
      ('${source}'::uuid,'acquisition_touch',
        jsonb_build_object('creator_challenge_id','${challenge}','source','creator','campaign','earliest'),now()-interval '2 minutes'),
      ('${target}'::uuid,'creator_challenge_open',
        jsonb_build_object('creator_challenge_id','${challenge}'),now()-interval '1 minute'),
      ('${target}'::uuid,'acquisition_touch',
        jsonb_build_object('creator_challenge_id','${challenge}','source','creator','campaign','later'),now()-interval '1 minute');
    CREATE OR REPLACE FUNCTION qa_pause_creator_merge()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id='${target}'::uuid THEN
        PERFORM pg_advisory_xact_lock(${advisory});
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER qa_pause_creator_merge
      BEFORE UPDATE ON players
      FOR EACH ROW EXECUTE FUNCTION qa_pause_creator_merge();
  `});

  holder=spawn('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-c',
    `SELECT pg_advisory_lock(${advisory}); SELECT pg_sleep(60);`],
    {stdio:['ignore','ignore','pipe']});
  await waitFor(()=>runPsql({sql:`SELECT NOT pg_try_advisory_lock(${advisory});`})==='t');

  merge=spawn('psql',[databaseUrl,'-X','-v','ON_ERROR_STOP=1','-c',
    `SELECT merge_pack1_player('${source}'::uuid,'${target}'::uuid);`],
    {stdio:['ignore','pipe','pipe']});
  await waitFor(()=>runPsql({sql:`
    SELECT EXISTS(
      SELECT 1 FROM pg_stat_activity
      WHERE query LIKE '%merge_pack1_player%'
        AND wait_event_type='Lock'
        AND wait_event='advisory'
    );`})==='t');

  // This commits a replacement function and the new database triggers while
  // the already-entered invocation still owns the old PL/pgSQL body.
  runPsql({file:'migrations/0054_creator_event_idempotency.sql'});

  holder.kill('SIGTERM');
  const mergeExit=await new Promise(resolve=>merge.once('exit',code=>resolve(code)));
  if(mergeExit!==0) {
    let stderr='';
    for await (const chunk of merge.stderr)stderr+=chunk;
    throw Error('Old in-flight merge failed after 0054 commit: '+stderr.trim());
  }

  const row=JSON.parse(runPsql({sql:`
    SELECT json_build_object(
      'source_exists',EXISTS(SELECT 1 FROM players WHERE id='${source}'::uuid),
      'open_count',(SELECT count(*) FROM analytics_events
        WHERE player_id='${target}'::uuid AND event_name='creator_challenge_open'
          AND event_props->>'creator_challenge_id'='${challenge}'),
      'touch_count',(SELECT count(*) FROM analytics_events
        WHERE player_id='${target}'::uuid AND event_name='acquisition_touch'
          AND event_props->>'creator_challenge_id'='${challenge}'),
      'campaign',(SELECT event_props->>'campaign' FROM analytics_events
        WHERE player_id='${target}'::uuid AND event_name='acquisition_touch'
          AND event_props->>'creator_challenge_id'='${challenge}' LIMIT 1)
    );`}));
  assert.equal(row.source_exists,false,'old merge still removes the guest identity');
  assert.equal(Number(row.open_count),1,'old in-flight merge converges creator opens after 0054 lands');
  assert.equal(Number(row.touch_count),1,'old in-flight merge converges acquisition touches after 0054 lands');
  assert.equal(row.campaign,'earliest','old in-flight merge preserves earliest acquisition attribution');
  console.log('PASS: 0054 is safe for an already-running pre-0054 account merge.');
} finally {
  holder?.kill('SIGTERM');
  merge?.kill('SIGTERM');
  try {
    runPsql({sql:`
      DROP TRIGGER IF EXISTS qa_pause_creator_merge ON players;
      DROP FUNCTION IF EXISTS qa_pause_creator_merge();
      DELETE FROM analytics_events WHERE event_props->>'creator_challenge_id'='${challenge}';
      DELETE FROM players WHERE id IN ('${source}'::uuid,'${target}'::uuid);
    `});
  } catch {}
}
