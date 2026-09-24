// Season integration gate. The first mode runs against the untouched production
// clone before fixture suites mutate it; the second mode runs destructive
// scenarios only at the very end of the disposable CI branch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const connection=process.argv[2];
const productionBootstrap=process.argv.includes('--production-bootstrap');
const devFixtures=process.argv.includes('--dev-fixtures');
if(!connection||productionBootstrap===devFixtures)throw new Error('Pass a connection file and exactly one season smoke mode.');
process.env.DATABASE_URL=fs.readFileSync(connection,'utf8').trim();

const {query,gameDateKey}=await import('../worker/growth-function.js');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const {ensureDailySchedule}=await import('../worker/draft-run-daily.mjs');
const {currentSeasonForPlayer,reconcilePersistedSeasons,resolveCurrentSeason}=await import('../worker/draft-run-season.mjs');

const parse=value=>typeof value==='string'?JSON.parse(value):value;
async function board(period,environment='mixed'){
  const response=await runApi.fetch(new Request(`https://packone.pro/v1/leaderboard?period=${period}&environment=${environment}`));
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  return data;
}

if(productionBootstrap){
  const scoreBefore=(await query("SELECT count(*) n,coalesce(sum(score),0)::text score_sum FROM scores WHERE mode='draft_run'")).rows[0];
  const season=await resolveCurrentSeason(query);
  const scoreAfter=(await query("SELECT count(*) n,coalesce(sum(score),0)::text score_sum FROM scores WHERE mode='draft_run'")).rows[0];
  assert.deepEqual(scoreAfter,scoreBefore,'Season bootstrap must not change ranked scores.');
  assert.ok(season,'Production clone must establish an inaugural season.');
  const earliest=(await query("SELECT min(challenge_date)::text day FROM scores WHERE mode='draft_run' AND set_id IN ('mixed','powered-cube','latest')")).rows[0]?.day||null;
  const first=(await query("SELECT day::text,daily_featured_sets FROM draft_run_schedules WHERE environment='latest' ORDER BY day LIMIT 1")).rows[0];
  assert.ok(earliest,'Production clone must contain ranked Draft Run history.');
  assert.ok(first,'Production clone must contain a Latest Set schedule after current-state resolution.');
  const firstSet=parse(first.daily_featured_sets)[0];
  const expectedStart=earliest<first.day?earliest:first.day;
  assert.equal(season.start_date,expectedStart);
  assert.equal(firstSet,season.set_id);
  const policy=(await query("SELECT set_id,set_name,release_date::text,regular_run,status FROM draft_run_environment_policy WHERE set_id=$1",[season.set_id])).rows[0];
  const newest=(await query("SELECT set_id FROM draft_run_environment_policy WHERE regular_run=true AND status IN ('Live','Paused') AND release_date<=$1::date ORDER BY release_date DESC,set_id LIMIT 1",[earliest])).rows[0]?.set_id||null;
  assert.ok(policy.regular_run===true||policy.regular_run==='t');
  assert.ok(policy.release_date<=earliest);
  assert.equal(newest,season.set_id);
  assert.equal(season.set_id,'hob');
  assert.equal(season.name,'The Hobbit');
  console.log('PACK_ONE_INAUGURAL_EVIDENCE '+JSON.stringify({season,earliest_ranked_date:earliest,first_latest_schedule_day:first.day,first_latest_set:firstSet,policy,newest_published_regular_set_on_ranked_launch:newest}));
  process.exit(0);
}

// From here on the branch is intentionally disposable and no later backend suite runs.
let source=(await query("SELECT corpus_version,puzzle_ids::text,difficulty_version,selection_version,scoring_version,serving_policy_version FROM draft_run_schedules WHERE environment='latest' ORDER BY day DESC LIMIT 1")).rows[0];
if(!source){
  await ensureDailySchedule(query,gameDateKey(),'latest');
  source=(await query("SELECT corpus_version,puzzle_ids::text,difficulty_version,selection_version,scoring_version,serving_policy_version FROM draft_run_schedules WHERE environment='latest' ORDER BY day DESC LIMIT 1")).rows[0];
}
assert.ok(source,'Need one valid schedule plan for season fixtures.');

await query("DELETE FROM draft_run_seasons");
await query("DELETE FROM draft_run_schedules WHERE environment='latest'");
await query("DELETE FROM scores WHERE mode='draft_run'");
await query("UPDATE draft_run_environment_policy SET status='Paused' WHERE regular_run=true AND status='Live'");

// With no season and no buildable Latest Set Daily, both canonical and old-client
// requests return the explicit HTTP-200 empty state.
let empty=await board('season');
assert.equal(empty.period,'season');assert.equal(empty.season,null);assert.deepEqual(empty.rows,[]);
let oldEmpty=await board('month');
assert.equal(oldEmpty.period,'season');assert.equal(oldEmpty.season,null);assert.deepEqual(oldEmpty.rows,[]);

await query("UPDATE draft_run_environment_policy SET status='Live' WHERE set_id IN ('msh','hob')");
const targetPlayer=crypto.randomUUID(),targetAuth=crypto.randomUUID(),profileKey=crypto.randomBytes(8).toString('hex');
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,false)',[targetAuth,'Season Target',`season-${targetPlayer}@example.invalid`]);
await query('INSERT INTO players(id,display_name,profile_key,profile_public,username_owned) VALUES($1::uuid,$2,$3,true,true)',[targetPlayer,'Season Target',profileKey]);
await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[targetAuth,targetPlayer]);
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) VALUES($1::uuid,'2026-07-01','mixed','draft_run',50,'C','[]'::jsonb)",[targetPlayer]);

async function schedule(day,setId){
  await query(`INSERT INTO draft_run_schedules(day,environment,corpus_version,puzzle_ids,difficulty_version,selection_version,daily_featured_sets,scoring_version,serving_policy_version)
    VALUES($1::date,'latest',$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8)`,[day,source.corpus_version,source.puzzle_ids,source.difficulty_version,source.selection_version,JSON.stringify([setId]),source.scoring_version,source.serving_policy_version]);
}

await schedule('2026-07-02','msh');
let season=await reconcilePersistedSeasons(query);
assert.equal(season.set_id,'msh');assert.equal(season.start_date,'2026-07-01');
assert.equal(season.established_by_day,'2026-07-02');

// The schedule is already there (created=false), simulating a successful Daily
// write followed by a failed season write. Later reconciliation repairs it.
await schedule('2026-09-01','hob');
const existing=await ensureDailySchedule(query,'2026-09-01','latest');
assert.equal(existing.created,false);
assert.equal((await query("SELECT set_id FROM draft_run_seasons WHERE end_date IS NULL")).rows[0].set_id,'msh');
season=await reconcilePersistedSeasons(query);
assert.equal(season.set_id,'hob');assert.equal(season.start_date,'2026-09-01');
assert.equal((await query("SELECT end_date::text FROM draft_run_seasons WHERE set_id='msh'")).rows[0].end_date,'2026-08-31');

await schedule('2026-09-02','msh');
await schedule('2026-09-03','hob');
season=await reconcilePersistedSeasons(query);
assert.equal(season.set_id,'hob');
assert.equal(Number((await query("SELECT count(*) n FROM draft_run_seasons")).rows[0].n),2);

// Concurrency from an unreconciled state still yields one open season.
await query("DELETE FROM draft_run_seasons");
const concurrent=await Promise.all(Array.from({length:6},()=>reconcilePersistedSeasons(query)));
assert.ok(concurrent.every(row=>row?.set_id==='hob'));
const counts=(await query("SELECT count(*) n,count(*) FILTER(WHERE end_date IS NULL) open FROM draft_run_seasons")).rows[0];
assert.equal(Number(counts.n),2);assert.equal(Number(counts.open),1);
const before=JSON.stringify((await query("SELECT set_id,set_name,set_release_date::text,start_date::text,end_date::text FROM draft_run_seasons ORDER BY start_date")).rows);
await reconcilePersistedSeasons(query);await reconcilePersistedSeasons(query);
assert.equal(JSON.stringify((await query("SELECT set_id,set_name,set_release_date::text,start_date::text,end_date::text FROM draft_run_seasons ORDER BY start_date")).rows),before);

// Expected unavailability leaves the established current season alone.
season=await resolveCurrentSeason(query,{today:'2026-09-03',ensureSchedule:async()=>{throw Object.assign(new Error('expected'),{status:503});}});
assert.equal(season.set_id,'hob');
await assert.rejects(()=>resolveCurrentSeason(query,{today:'2026-09-03',ensureSchedule:async()=>{throw Object.assign(new Error('unexpected'),{status:500});}}),/unexpected/);

// Seed all three environment standings in the same HOB season.
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) VALUES ($1::uuid,'2026-09-01','mixed','draft_run',10,'F','[]'::jsonb),($1::uuid,'2026-09-01','powered-cube','draft_run',91,'A','[]'::jsonb),($1::uuid,'2026-09-01','latest','draft_run',82,'B','[]'::jsonb)",[targetPlayer]);

// More than 100 eligible peers prove profile rank is calculated before the
// public board's LIMIT 100.
const peers=Array.from({length:105},(_,i)=>({id:crypto.randomUUID(),auth_id:crypto.randomUUID(),name:`Season Peer ${String(i).padStart(3,'0')}`,email:`season-peer-${i}-${targetPlayer}@example.invalid`}));
await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") SELECT id::uuid,name,email,false FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,email text)',[JSON.stringify(peers)]);
await query('INSERT INTO players(id,display_name,username_owned) SELECT id::uuid,name,true FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text)',[JSON.stringify(peers)]);
await query('INSERT INTO account_links(auth_user_id,player_id) SELECT auth_id::uuid,id::uuid FROM jsonb_to_recordset($1::jsonb) AS x(id text,auth_id text)',[JSON.stringify(peers)]);
await query("INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) SELECT id::uuid,'2026-09-01','mixed','draft_run',20,'F','[]'::jsonb FROM jsonb_to_recordset($1::jsonb) AS x(id text)",[JSON.stringify(peers)]);

const profileSeason=await currentSeasonForPlayer(query,targetPlayer,{today:'2026-09-03',ensureSchedule:async()=>({created:false})});
assert.equal(profileSeason.set_id,'hob');
assert.deepEqual(profileSeason.standings.map(row=>row.environment),['mixed','powered-cube','latest']);
assert.equal(profileSeason.standings.find(row=>row.environment==='mixed').rank,106);
assert.equal(profileSeason.standings.find(row=>row.environment==='mixed').average,10);
assert.equal(profileSeason.standings.find(row=>row.environment==='mixed').days,1);

const seasonBoards=[];
for(const environment of ['mixed','powered-cube','latest']){
  const data=await board('season',environment);
  assert.equal(data.period,'season');assert.equal(data.season.set_id,'hob');assert.equal(data.start,'2026-09-01');
  seasonBoards.push(data);
}
const oldClient=await board('month','mixed');
assert.equal(oldClient.period,'season');assert.equal(oldClient.season.set_id,'hob');
assert.deepEqual(oldClient.rows,seasonBoards[0].rows);

// A genuinely later persisted release advances B -> C; editing mutable policy
// afterward cannot move the stored season release or reopen B.
const tmtOriginal=(await query("SELECT release_date::text,status,set_name FROM draft_run_environment_policy WHERE set_id='tmt'")).rows[0];
await query("UPDATE draft_run_environment_policy SET release_date='2026-09-14',status='Live' WHERE set_id='tmt'");
await schedule('2026-09-15','tmt');
season=await reconcilePersistedSeasons(query);
assert.equal(season.set_id,'tmt');assert.equal(season.start_date,'2026-09-15');assert.equal(season.set_release_date,'2026-09-14');
assert.equal((await query("SELECT end_date::text FROM draft_run_seasons WHERE set_id='hob'")).rows[0].end_date,'2026-09-14');
await query("UPDATE draft_run_environment_policy SET release_date=$1::date,status=$2 WHERE set_id='tmt'",[tmtOriginal.release_date,tmtOriginal.status]);
season=await reconcilePersistedSeasons(query);
assert.equal(season.set_id,'tmt');assert.equal(season.set_release_date,'2026-09-14');

console.log('Pack One season backend smoke passed: no-season 200, month alias, inaugural backfill, retry repair, idempotency, concurrency, A -> B -> A monotonicity, B -> C advancement, shared windows and profile rank >100.');
