import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readClosedStandings, saveClosedStandings} from '../scripts/capture-season-standings.mjs';

const closed = {set_id:'fra', set_name:'Reality Fracture', start_date:'2026-10-01',
  end_date:'2026-11-20', next_set:'trk', captured_at:'2026-11-21T10:00:00Z'};

test('closed dates and original ranking apply to every board, including empty boards and ties past 100', async () => {
  const ranked = Array.from({length:102}, (_, i) => ({rank:i<100 ? i+1 : 101, player_id:'internal',
    profile_key:'private-key', display_name:'Fixture '+i, score:87, average_score:91.5, days:8}));
  const boards = [];
  const commands = [];
  const snapshot = await readClosedStandings(async (sql, args) => {
    if (!args) { commands.push(sql); return {rows:[]}; }
    if (sql.includes('FROM draft_run_seasons')) {
      assert.deepEqual(args, ['fra', 'trk']);
      return {rows:[closed]};
    }
    const [start, end, environment, , limit] = args;
    assert.deepEqual([start,end,limit], [closed.start_date,closed.end_date,null]);
    boards.push(environment);
    return {rows:environment === 'mixed' ? ranked : []};
  }, 'fra', 'trk');
  assert.deepEqual(boards, ['mixed','powered-cube','latest']);
  assert.match(commands[0], /REPEATABLE READ READ ONLY/);
  assert.equal(commands[1], 'COMMIT');
  assert.equal(snapshot.boards.mixed.standings.length,102);
  assert.deepEqual(snapshot.boards.mixed.standings.slice(-2).map(row=>row.rank),[101,101]);
  assert.deepEqual(snapshot.boards.mixed.standings[0], {
    rank:1,display_name:'Fixture 0',rating:87,average_score:91.5,days:8});
  assert.deepEqual(snapshot.boards.latest.standings,[]);
});

test('an unrecorded rollover ends before standings are read', async () => {
  const statements = [];
  await assert.rejects(readClosedStandings(async (sql) => {
    statements.push(sql);
    return {rows:[]};
  }, 'fra', 'trk'), /transition has not been recorded/);
  assert.equal(statements.length, 3);
  assert.equal(statements.at(-1),'ROLLBACK');
});

test('capture files stay private and concurrent retries cannot replace the first complete file', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'private-standings-test-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const statuses = await Promise.allSettled([1,2].map(run=>saveClosedStandings({...closed,run},directory)));
  assert.equal(statuses.filter(s=>s.status==='fulfilled').length,1);
  assert.equal(statuses.find(s=>s.status==='rejected').reason.code,'EEXIST');
  const [filename] = await readdir(directory);
  const target = join(directory,filename);
  const first = await readFile(target,'utf8');
  assert.equal(JSON.parse(first).run,statuses.findIndex(s=>s.status==='fulfilled')+1);
  assert.equal((await stat(target)).mode & 0o777,0o600);
  await assert.rejects(saveClosedStandings(closed,directory),{code:'EEXIST'});
  assert.equal(await readFile(target,'utf8'),first);
  await assert.rejects(saveClosedStandings(closed,new URL('../',import.meta.url)),/outside the repository/);
});
