import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const domain=process.argv[2];
if(domain!=='account')throw Error('Only the account domain has a local qualification runner');
const db=new URL(process.env.PACK1_TEST_DATABASE_URL);
if(!['postgres:','postgresql:'].includes(db.protocol)||!['localhost','127.0.0.1','[::1]'].includes(db.hostname)||
  db.pathname!=='/pack1'||db.username!=='pack1_ci')throw Error('Database fixtures require a local pack1 database owned by the pack1_ci test role');
const {fixturePool}=await import('../tests/support/postgres-fixture.mjs');
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
