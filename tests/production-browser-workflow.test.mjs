import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('production measurement suite fails closed unless Neon reports the production compute idle',()=>{
  const source=fs.readFileSync('.github/workflows/production-browser.yml','utf8');
  assert.match(source,/options:\s*\[mixed, powered-cube, latest, all\]/);
  assert.match(source,/measurement_samples:/);
  assert.match(source,/options:\s*\['1', '2', '3'\]/);
  assert.match(source,/NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(source,/env -u NEON_API_KEY PACK1_DAILY_FIRST/);
  assert.match(source,/patient-shadow-91417882/);
  assert.match(source,/br-orange-feather-ayps8kep/);
  assert.match(source,/branches\/\$\{branch\}\/endpoints/);
  assert.match(source,/endpoint\.type==='read_write'/);
  assert.match(source,/state==='idle'/);
  assert.match(source,/did not become idle before the measurement deadline/);
  assert.match(source,/environments=\(mixed powered-cube latest\)/);
  assert.match(source,/measurements-\$\{environment\}-\$\{sample\}\.json/);
  assert.match(source,/neon-idle-\$\{environment\}-\$\{sample\}\.json/);
});
