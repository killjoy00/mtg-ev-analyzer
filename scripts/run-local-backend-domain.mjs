import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fixturePool} from '../tests/support/postgres-fixture.mjs';

const domain=process.argv[2];
if(domain!=='account')throw Error('Only the account domain has a local qualification runner');
// Validate before starting any suite. The worker connection inside each child
// is synthetic and can only reach the test-only PostgreSQL wire adapter.
const validation=fixturePool();await validation.query('SELECT 1');await validation.end();
const map=JSON.parse(fs.readFileSync('scripts/backend-gate-map.json','utf8'));
for(const suite of map.domains[domain].suites) {
  console.log('Local PostgreSQL integration suite: '+suite);
  const result=spawnSync(process.execPath,['tests/support/local-backend-suite.mjs',suite],{
    stdio:'inherit',env:process.env,timeout:120000,
  });
  if(result.error||result.status!==0)throw Error('Local account integration suite failed: '+suite);
}
console.log('All existing account integration assertions passed on local PostgreSQL.');
