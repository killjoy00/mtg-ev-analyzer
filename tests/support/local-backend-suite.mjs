// Runs an existing integration suite unchanged through its real SQL HTTP wire
// contract against local PostgreSQL. No external provider calls are permitted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const map=JSON.parse(fs.readFileSync('scripts/backend-gate-map.json','utf8'));
const suite=process.argv[2];
if(!map.domains.account.suites.includes(suite))throw Error('Only reviewed account suites may use local PostgreSQL');
const {fixturePool,postgresTransport,SQL_CONNECTION}=await import('./postgres-fixture.mjs');
const pool=fixturePool(); // validates local host, database and dedicated test role
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pack1-local-account-'));
const connectionFile=path.join(directory,'connection');
fs.writeFileSync(connectionFile,SQL_CONNECTION,{mode:0o600});
const originalFetch=globalThis.fetch;
globalThis.fetch=postgresTransport(pool);
process.argv=[process.argv[0],path.resolve(suite),connectionFile,'--dev-fixtures'];
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS neon_auth.account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
    "providerId" text NOT NULL,"accountId" text NOT NULL,password text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now())`);
  // The production-clone suite intentionally does not create managed Auth
  // rows. Supply only its documented prerequisites in this disposable fixture.
  if(suite==='tests/account-deletion-backend-smoke.mjs') {
    await pool.query(`CREATE TABLE IF NOT EXISTS neon_auth.verification (
      id uuid PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,
      "expiresAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now())`);
    for(let i=0;i<5;i++)await pool.query(`INSERT INTO neon_auth."user"(id,name,email,"emailVerified")
      VALUES(gen_random_uuid(),$1,$2,true)`,[`Local deletion fixture ${i}`,`local-delete-${crypto.randomUUID()}@example.invalid`]);
  }
  await import(pathToFileURL(path.resolve(suite)).href);
} finally {
  globalThis.fetch=originalFetch;
  await pool.end();
  fs.rmSync(directory,{recursive:true,force:true});
}
