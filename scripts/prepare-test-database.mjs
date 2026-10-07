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
const catalog=JSON.parse(fs.readFileSync(root+'/catalog.json'));
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
    if(path==='migrations/0004_draft_run_product.sql') {
      apply('tests/support/legacy-retirement-schema.sql');
      // Historical migrations ran after these environments had been imported.
      // Reproduce that prerequisite, including the four later-retired sets.
      for(const id of new Set([...catalog.sets.map(set=>set.id),'stx','mid','vow','snc'])) {
        const set=catalog.sets.find(set=>set.id===id)||{id,name:id.toUpperCase(),first_pick:1,last_pick:11};
        await query('INSERT INTO draft_run_verified_sets(set_id,corpus_version,manifest) VALUES($1,$2,$3::jsonb)',[id,catalog.corpus_version,JSON.stringify({...set,model_version:catalog.model_version})]);
      }
    }
  }
  for(const set of catalog.sets) {
    const bytes=fs.readFileSync(`${root}/${set.id}.json.gz`);
    if(createHash('sha256').update(bytes).digest('hex')!==set.sha256)throw Error('Fixture checksum changed: '+set.id);
    const rows=JSON.parse(gunzipSync(bytes));
    await stageCorpusManifest(query,set.id,catalog.corpus_version,{...set,model_version:catalog.model_version});
    for(let i=0;i<rows.length;i+=250)await insertTrophyBatch(query,rows.slice(i,i+250));
  }
  await refreshServingStatistics(query);
  await registerServingReadiness(query);
  const status=await advanceServingReadiness(query,{release:'ci-fixture'});
  if(!status.ready||!status.current)throw Error('Fixture failed real serving readiness: '+JSON.stringify(status));
  console.log('Prepared real PostgreSQL fixture with current serving readiness.');
} finally {await pool.end();}
