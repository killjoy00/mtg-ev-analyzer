// Rebased release contract: keep orchestration pinned to reviewed main revisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {releasePlan} from '../scripts/card-image-release.mjs';

test('card-image release plan is fixed dev -> prod -> image refresh',()=>{
  const commit='a'.repeat(40);
  assert.deepEqual(releasePlan(commit),[
    {
      workflow:'deploy-functions.yml',
      label:'development deploy',
      inputs:{target:'development',commit},
      title:'deploy development '+commit,
    },
    {
      workflow:'deploy-functions.yml',
      label:'production deploy',
      inputs:{target:'production',commit},
      title:'deploy production '+commit,
    },
    {
      workflow:'refresh-powered-cube-images.yml',
      label:'card-image refresh',
      inputs:{request_id:'release-'+commit.slice(0,12),code_commit:commit},
      title:'refresh Pack One card images / release-'+commit.slice(0,12),
    },
  ]);
  assert.throws(()=>releasePlan('main'),/full reviewed main commit/);
});

test('card-image release workflow cannot deploy directly or select arbitrary children',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/card-image-release.yml',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../scripts/card-image-release.mjs',import.meta.url),'utf8');
  assert.match(workflow,/permissions:\s+contents: read\s+actions: write/);
  assert.doesNotMatch(workflow,/NEON_API_KEY|functions deploy|aws s3|DATABASE_URL/);
  assert.match(source,/deploy-functions\.yml/);
  assert.match(source,/refresh-powered-cube-images\.yml/);
  assert.doesNotMatch(source,/process\.argv\[3\]|workflow=.*process|target=.*process/);
});
