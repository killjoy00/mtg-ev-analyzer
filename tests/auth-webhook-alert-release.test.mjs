import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('production authhook alert polls retained logs and routes failures to assigned GitHub issues',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-webhook-alert.yml',import.meta.url),'utf8');
  const source=fs.readFileSync(new URL('../scripts/auth-webhook-alert.mjs',import.meta.url),'utf8');
  assert.match(workflow,/cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow,/issues: write/);
  assert.match(workflow,/CLOUDFLARE_EDGE_TOKEN: \$\{\{ secrets\.CLOUDFLARE_EDGE_TOKEN \}\}/);
  assert.match(workflow,/node scripts\/auth-webhook-alert\.mjs check/);
  assert.match(workflow,/node scripts\/auth-webhook-alert\.mjs alert/);
  assert.match(source,/workers\/observability\/telemetry\/query/);
  assert.match(source,/datasets:\['cloudflare-workers'\]/);
  assert.match(source,/PACK1_AUTHHOOK_ALERT_SERVICE/);
  assert.match(source,/user\/tokens\/verify/);
  assert.match(source,/observability telemetry query/);
  assert.match(source,/HTTP '\+response\.status/);
  assert.match(source,/\[authhook alert\] Production recovery webhook failure/);
  assert.match(source,/assignees:\[owner\]/);
  for(const status of ['invalid_signature','delivery_failure','rejected_event'])assert.match(source,new RegExp(status));
  assert.doesNotMatch(source,/PACK1_DELETION_ADMIN_EMAIL/);
  const control=fs.readFileSync(new URL('../scripts/auth-webhook-control.mjs',import.meta.url),'utf8');
  assert.match(control,/observability:\{enabled:true,logs:\{enabled:true,invocation_logs:true,head_sampling_rate:1,persist:true\}\}/);
});
