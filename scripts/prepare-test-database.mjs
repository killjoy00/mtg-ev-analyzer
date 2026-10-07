import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fixturePool,textTypes} from '../tests/support/postgres-fixture.mjs';
import {migrationPlan} from './ci-migration-plan.mjs';
import {stageCorpusManifest} from './stage-corpus-manifest.mjs';
import {insertTrophyBatch} from '../worker/trophy-import.mjs';
import {registerServingReadiness,advanceServingReadiness} from '../worker/corpus-readiness.mjs';
import {refreshServingStatistics} from '../worker/serving-statistics.mjs';
const pool=fixturePool(),root='tests/fixtures/draft-run';
const query=async(sql,params=[])=>pool.query({text:sql,values:params,types:textTypes});
const apply=path=>execFileSync('psql',[process.env.PACK1_TEST_DATABASE_URL,'-X','-v','ON_ERROR_STOP=1','-f',path],{stdio:'inherit'});
try {
  // Refuse to reset an existing database, even at the permitted local address.
  if((await query("SELECT 1 FROM information_schema.tables WHERE table_schema IN ('public','neon_auth') LIMIT 1")).rows.length)throw Error('Fixture database must be empty');
  apply('tests/support/neon-auth-schema.sql');
  apply('worker/schema.sql');
  const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json'));
  for(const path of migrationPlan(manifest,'fresh',{fresh:true})) {
    console.log('Applying '+path);apply(path);
  }
  const catalog=JSON.parse(fs.readFileSync(root+'/catalog.json'));
  for(const set of catalog.sets) {
    const bytes=fs.readFileSync(`${root}/${set.id}.json.gz`);
    if(createHash('sha256').update(bytes).digest('hex')!==set.sha256)throw Error('Fixture checksum changed: '+set.id);
    const rows=JSON.parse(gunzipSync(bytes));
    await stageCorpusManifest(query,set.id,catalog.corpus_version,{...set,model_version:catalog.model_version});
    for(let i=0;i<rows.length;i+=250)await insertTrophyBatch(query,rows.slice(i,i+250));
  }
  // The baseline importer predates snapshots. Freeze its retained identity in
  // exactly the same way as the deployed snapshot migration, after import.
  apply('migrations/0041_corpus_source_snapshots.sql');
  await refreshServingStatistics(query);
  await registerServingReadiness(query);
  const status=await advanceServingReadiness(query,{release:'ci-fixture'});
  if(!status.ready||!status.current)throw Error('Fixture failed real serving readiness: '+JSON.stringify(status));
  console.log('Prepared real PostgreSQL fixture with current serving readiness.');
} finally {await pool.end();}
