import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('v6 fixture provenance is captured after Cube admission and before validation or publication',()=>{
  const workflow=fs.readFileSync('.github/workflows/rebuild-v6-draft-run-corpus.yml','utf8');
  const assemble=workflow.indexOf('python scripts/v6_rebuild.py assemble');
  const admission=workflow.indexOf('node scripts/v6-cube-reroll-admission.mjs');
  const refresh=workflow.indexOf('node scripts/build-test-corpus-fixture.mjs');
  const validation=workflow.indexOf('Validate corpus accounting, source trajectories, models and Traditional gates');
  const publication=workflow.indexOf('name: validated-v6-candidate-');
  assert.ok(assemble>=0&&admission>assemble,'admit the assembled corpus');
  assert.ok(refresh>admission,'Cube admission changes corpus membership; fixture provenance must describe the admitted corpus');
  assert.ok(validation>refresh&&publication>validation,'validate refreshed fixtures before publishing');
  assert.match(workflow.slice(validation,publication),/REQUIRE_REPLAY_SHARDS=1 npm test/);
  assert.doesNotMatch(workflow,/--refresh-golden/);
  assert.match(workflow,/test "\$golden_sha" = "\$\(sha256sum tests\/fixtures\/draft-run\/scoring-golden\.json\)"/);
  assert.match(workflow,/git add [^\n]*tests\/fixtures\/draft-run/);
});
