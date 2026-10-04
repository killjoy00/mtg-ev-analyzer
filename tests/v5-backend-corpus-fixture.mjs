// Supply real, immutable v5 trophy decisions to disposable backend CI branches.
// The small replay baseline alone cannot provide 16 sources per custom pick/band.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION,V5_CORPUS_VERSION} from '../draft-run.mjs';
import {validateComponents,importComponents} from '../scripts/load-traditional-components.mjs';

const [connection,candidate]=process.argv.slice(2);
const branch=process.env.PACK1_CI_BRANCH_ID||'';
assert.ok(process.argv.includes('--dev-fixtures')&&process.env.GITHUB_ACTIONS==='true');
assert.match(branch,/^br-[a-z0-9-]+$/);
assert.ok(!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch));
assert.equal(DRAFT_RUN_CORPUS_VERSION,V5_CORPUS_VERSION);
assert.ok(connection&&candidate);
const release=JSON.parse(fs.readFileSync('research/v5-validated-release.json'));
// Verify all original artifact hashes and the reviewed release before selecting
// fixture sets; never modify the accepted candidate directory or its catalog.
execFileSync(process.execPath,['scripts/verify-v5-release-candidate.mjs',candidate,String(release.run_id)],{stdio:'inherit'});
const input=path.join(candidate,'v5-trophy-import');
const catalog=JSON.parse(fs.readFileSync(path.join(input,'catalog.json')));
const ids=['blb','hob','msh','neo'];
const selected=catalog.sets.filter(s=>ids.includes(s.id));
assert.deepEqual(selected.map(s=>s.id).sort(),ids);
const fixture='generated/v5-ci-corpus';
fs.mkdirSync(fixture,{recursive:true});
for(const s of selected)fs.cpSync(path.join(input,s.id),path.join(fixture,s.id),{recursive:true});
fs.writeFileSync(path.join(fixture,'catalog.json'),JSON.stringify({...catalog,sets:selected,requested_sets:ids}));
execFileSync(process.execPath,['scripts/load_all_trophies.mjs',connection,fixture,'--stage-only'],{stdio:'inherit'});
const query=corpusDatabase(connection);
// These fixture-only pointer changes are confined to the fresh CI clone. Real
// development/production publication remains behind the release workflow gates.
for(const s of selected) {
  const policy=(await query('SELECT status FROM draft_run_environment_policy WHERE set_id=$1',[s.id])).rows[0];
  assert.equal(policy?.status,'Live');
  const updated=await query(`UPDATE corpus_source_snapshots SET lifecycle_status='Approved'
    WHERE source_snapshot_id=$1 AND corpus_version=$2 AND lifecycle_status='Blocked'
    RETURNING source_snapshot_id`,[s.source_snapshot_id,V5_CORPUS_VERSION]);
  assert.equal(updated.rows.length,1);
  await query('UPDATE draft_run_environment_policy SET active_snapshot_id=$2 WHERE set_id=$1',[s.id,s.source_snapshot_id]);
}
console.log(JSON.stringify({fixture:'exact-v5-trophy-custom-practice',sets:ids,branch}));
// The lifecycle/readiness suite also needs a real Live supplemental source on
// the current parent. Verify the complete artifact, then import exact BLB bytes.
const traditional=(await validateComponents(path.join(candidate,'v5-traditional')))
  .filter(s=>s.sid==='blb'&&s.health.ready);
assert.equal(traditional.length,1,'Accepted BLB Traditional fixture must pass its gates');
await importComponents(query,traditional);
const component=traditional[0].manifest.component_version;
const promoted=await query("UPDATE corpus_components SET status='Live' WHERE set_id='blb' AND parent_version=$1 AND component_version=$2 AND status='Candidate' RETURNING component_version",[V5_CORPUS_VERSION,component]);
assert.equal(promoted.rows.length,1);
console.log(JSON.stringify({fixture:'exact-v5-traditional-readiness',set:'blb',component,branch}));
