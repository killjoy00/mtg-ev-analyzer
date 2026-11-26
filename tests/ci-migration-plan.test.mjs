import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {migrationPlan} from '../scripts/ci-migration-plan.mjs';
const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json'));
test('CI migrations use the authoritative dependency order, including duplicate prefixes',()=>{
  const full=migrationPlan(manifest,'fresh',{fresh:true});
  assert.deepEqual(full,manifest.ordered.map(name=>'migrations/'+name));
  for(const plan of ['backend-gate-backlog','launch-load','launch-distributed']) {
    const selected=migrationPlan(manifest,plan);
    assert.deepEqual(selected,full.filter(path=>manifest.release_paths[plan].migrations.includes(path.slice(11))));
  }
});
test('modified, removed and unregistered migrations fail before database writes',()=>{
  for(const status of ['M','D','R100'])assert.throws(()=>migrationPlan(manifest,'backend-gate-backlog',{changes:[[status,'migrations/0055_creator_event_write_safety.sql']]}),/immutable/);
  assert.throws(()=>migrationPlan(manifest,'backend-gate-backlog',{changes:[['A','migrations/9999_unregistered.sql']]}),/Unregistered/);
  assert.throws(()=>migrationPlan(manifest,'unknown'),/Unknown/);
});

test('merged midseason schedule migration remains in all clone schema plans with no PR migration diff',()=>{
  const migration='migrations/0084_automatic_midseason_schedule.sql';
  for(const plan of ['backend-gate-backlog','launch-load','launch-distributed','secure-auth-release']) {
    const selected=migrationPlan(manifest,plan,{changes:[]});
    const prerequisite=selected.indexOf('migrations/0083_private_patreon_season_receipts.sql');
    assert.ok(prerequisite>=0 && selected.indexOf(migration)>prerequisite,plan);
  }
});
