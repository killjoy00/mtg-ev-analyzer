import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const destination=process.env.LOAD_FIXTURE_FILE;
// Two independently validated fixture batches provide unique identities for
// every 25/100/500/1000 stage, with no between-stage quota resets or DB deletes.
const batches=[],reports=[];
for(let i=0;i<2;i++) {
  execFileSync(process.execPath,['scripts/launch-load-fixtures.mjs'],{env:process.env,stdio:'inherit'});
  batches.push(JSON.parse(fs.readFileSync(destination,'utf8')));
  reports.push(JSON.parse(fs.readFileSync('artifacts/launch-load/fixture-report.json','utf8')));
}
fs.writeFileSync(destination,JSON.stringify({...batches[0],users:batches.flatMap(b=>b.users)}),{mode:0o600});
fs.writeFileSync('artifacts/launch-load/fixture-report.json',JSON.stringify({users:2000,synthetic_score_rows:180000,batches:reports},null,2));
