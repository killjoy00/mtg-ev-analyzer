import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeLeaderboardPeriod,resolveCurrentSeason} from '../worker/draft-run-season.mjs';

const [migration,hardeningMigration,seasonModule,backend,client,legacyWorker,legacyCore,growth,myPack,migrationWorkflow,hardeningWorkflow,releaseSmoke]=await Promise.all([
  readFile(new URL('../migrations/0037_pack_one_seasons.sql',import.meta.url),'utf8'),
  readFile(new URL('../migrations/0038_pack_one_season_hardening.sql',import.meta.url),'utf8'),
  readFile(new URL('../worker/draft-run-season.mjs',import.meta.url),'utf8'),
  readFile(new URL('../worker/draft-run-function.mjs',import.meta.url),'utf8'),
  readFile(new URL('../draft-run-product.mjs',import.meta.url),'utf8'),
  readFile(new URL('../worker/index.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/core.mjs',import.meta.url),'utf8'),
  readFile(new URL('../worker/growth-function.js',import.meta.url),'utf8'),
  readFile(new URL('../my-pack-one.mjs',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/pack-one-season-migration.yml',import.meta.url),'utf8'),
  readFile(new URL('../.github/workflows/pack-one-season-hardening-migration.yml',import.meta.url),'utf8'),
  readFile(new URL('./release-functions-smoke.mjs',import.meta.url),'utf8'),
]);

test('current leaderboard canonicalizes old month clients to season',()=>{
  assert.equal(normalizeLeaderboardPeriod('month'),'season');
  assert.equal(normalizeLeaderboardPeriod('season'),'season');
  assert.match(backend,/normalizeLeaderboardPeriod/);
  assert.match(backend,/\['daily','week','season','all'\]/);
  assert.match(client,/value==='month'\?'season':value/);
  assert.match(client,/This season/);
  assert.doesNotMatch(client,/This month/);
});

test('legacy monthly leaderboard remains unchanged',()=>{
  assert.match(legacyWorker,/monthly/);
  assert.match(legacyCore,/monthly/);
  assert.doesNotMatch(legacyWorker,/draft_run_seasons/);
  assert.doesNotMatch(legacyCore,/draft_run_seasons/);
});

test('season storage is durable, monotonic and serialized',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS draft_run_seasons/);
  assert.match(migration,/set_name text NOT NULL/);
  assert.match(migration,/set_release_date date NOT NULL/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS draft_run_seasons_current_uq/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/policy\.release_date <= current_season\.set_release_date/);
  assert.match(migration,/WHERE set_id=candidate_set/);
  assert.doesNotMatch(migration,/REFERENCES draft_run_environment_policy/);
  assert.match(hardeningMigration,/CREATE TABLE IF NOT EXISTS draft_run_season_reconciliation_state/);
  assert.match(hardeningMigration,/last_reconciled_day date/);
  assert.match(hardeningMigration,/day::date > reconciled_through/);
  assert.match(hardeningMigration,/SET last_reconciled_day=scheduled\.day/);
});

test('current season resolution ensures Latest Set Daily before reconciliation',async()=>{
  const calls=[];
  const query=async sql=>{calls.push('reconcile');assert.match(sql,/pack1_reconcile_draft_run_seasons/);return {rows:[{id:'hob',set_id:'hob',set_name:'The Hobbit',set_release_date:'2026-08-14',start_date:'2026-09-10',end_date:null,established_by_day:'2026-09-19'}]};};
  const season=await resolveCurrentSeason(query,{today:'2026-09-23',ensureSchedule:async(_q,day,environment)=>{calls.push('ensure');assert.equal(day,'2026-09-23');assert.equal(environment,'latest');}});
  assert.deepEqual(calls,['ensure','reconcile']);
  assert.equal(season.name,'The Hobbit');
  assert.equal(season.start_date,'2026-09-10');
});

test('season reads are side-effect free unless the Draft Run caller explicitly supplies the Daily writer',async()=>{
  const calls=[];
  const query=async sql=>{calls.push('reconcile');assert.match(sql,/pack1_reconcile_draft_run_seasons/);return {rows:[]};};
  assert.equal(await resolveCurrentSeason(query,{today:'2026-09-23'}),null);
  assert.deepEqual(calls,['reconcile']);
  assert.doesNotMatch(seasonModule,/draft-run-daily/);
  assert.match(backend,/resolveCurrentSeason\(query,\{today,ensureSchedule:ensureDailyScheduleForQuery\}\)/);
});

test('expected Latest Set unavailability retains persisted season, unexpected failures surface',async()=>{
  const row={id:'hob',set_id:'hob',set_name:'The Hobbit',set_release_date:'2026-08-14',start_date:'2026-09-10',end_date:null,established_by_day:'2026-09-19'};
  const query=async()=>({rows:[row]});
  const season=await resolveCurrentSeason(query,{today:'2026-09-23',ensureSchedule:async()=>{throw Object.assign(new Error('unavailable'),{status:503});}});
  assert.equal(season.id,'hob');
  await assert.rejects(()=>resolveCurrentSeason(query,{ensureSchedule:async()=>{throw Object.assign(new Error('broken'),{status:500});}}),/broken/);
});

test('profiles and leaderboard use the same current season implementation',()=>{
  assert.match(growth,/currentSeasonForProfile\(playerId\)/);
  assert.match(growth,/profile_current_season_unavailable/);
  assert.match(growth,/return null;/);
  assert.match(myPack,/current_season/);
  assert.match(myPack,/if\(!season\|\|!rows\.length\)return ''/);
  assert.match(myPack,/Current season/);
  assert.match(myPack,/#'\+num\(row\.rank\)/);
  assert.match(client,/run-board-season/);
  assert.match(client,/Season ·/);
  assert.match(growth,/eventProps\.mode==='draft_run'&&eventProps\.period==='month'/);
  assert.match(growth,/eventProps\.period='season'/);
});


test('season release uses the reviewed exact-revision migration and acceptance path',()=>{
  assert.match(migrationWorkflow,/git merge-base --is-ancestor/);
  assert.match(migrationWorkflow,/migrations\/0037_pack_one_seasons\.sql/);
  assert.match(hardeningWorkflow,/migrations\/0038_pack_one_season_hardening\.sql/);
  assert.match(hardeningWorkflow,/development\) branch=br-twilight-hill-ayffyd2b/);
  assert.match(hardeningWorkflow,/production\) branch=br-orange-feather-ayps8kep/);
  assert.match(migrationWorkflow,/development\) branch=br-twilight-hill-ayffyd2b/);
  assert.match(migrationWorkflow,/production\) branch=br-orange-feather-ayps8kep/);
  assert.match(releaseSmoke,/leaderboard\?period=season/);
  assert.match(releaseSmoke,/\['mixed','powered-cube','latest'\]/);
  assert.match(releaseSmoke,/All three boards must share one season/);
  assert.ok(releaseSmoke.indexOf('await waitForStableMarkers();') < releaseSmoke.indexOf('const seasonBoards=[]'));
});
