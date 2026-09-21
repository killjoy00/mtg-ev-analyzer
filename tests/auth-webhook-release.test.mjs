import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest=fs.readFileSync('.github/neon-functions.txt','utf8');
const deploy=fs.readFileSync('.github/workflows/deploy-functions.yml','utf8');
const secure=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
const releaseSmoke=fs.readFileSync('tests/release-functions-smoke.mjs','utf8');
const secureSmoke=fs.readFileSync('tests/secure-auth-release-smoke.mjs','utf8');
const ingress=fs.readFileSync('edge/auth-webhook-ingress.mjs','utf8');

test('fourth Auth webhook function is an explicit reviewed release artifact',()=>{
  assert.match(manifest,/^pack1authhook:worker\/auth-webhook-function\.mjs$/m);
  for(const smoke of [releaseSmoke,secureSmoke])assert.match(smoke,/pack1authhook/);
});

test('Resend credential is scoped only to pack1authhook deploy branches',()=>{
  for(const workflow of [deploy,secure]) {
    assert.match(workflow,/PACK1_RESEND_API_KEY: \$\{\{ secrets\.PACK1_RESEND_API_KEY \}\}/);
    assert.match(workflow,/\[\[ "\$slug" == pack1authhook \]\]/);
    assert.match(workflow,/--env "PACK1_RESEND_API_KEY=\$PACK1_RESEND_API_KEY"/);
    const deployBlocks=[...workflow.matchAll(/while IFS=: read -r slug entry; do([\s\S]*?)done < \.github\/neon-functions\.txt/g)].map(match=>match[1]);
    assert.ok(deployBlocks.length>=1);
    for(const block of deployBlocks) {
      const secretUse=block.indexOf('PACK1_RESEND_API_KEY=$PACK1_RESEND_API_KEY');
      const authBranch=block.indexOf('$slug" == pack1authhook');
      assert.ok(secretUse>authBranch,'Resend secret must appear only inside the pack1authhook branch');
      const before=block.slice(0,authBranch);
      assert.doesNotMatch(before,/PACK1_RESEND_API_KEY=\$PACK1_RESEND_API_KEY/);
    }
  }
});

test('permanent Auth ingress is separate from the browser API gateway and preserves raw body forwarding',()=>{
  assert.doesNotMatch(ingress,/gateway\.mjs|readJson|JSON\.stringify\(await/);
  assert.match(ingress,/new Uint8Array\(await request\.arrayBuffer\(\)\)/);
  assert.match(ingress,/-pack1authhook\.compute\.c-5\.us-east-2\.aws\.neon\.tech\/webhook/);
  assert.doesNotMatch(ingress,/access-control-allow-origin|cookie|csrf/i);
});
