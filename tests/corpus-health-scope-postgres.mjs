// Run against the workflow's empty, disposable PostgreSQL service. All data is
// VALUES/CTE fixtures: no Neon connection and no production corpus payloads.
// Extract the actual query literals so these tests fail on SQL regressions,
// rather than merely asserting that a desired string appears in the source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {loadHealthEvidenceRows,classifyHealthEvidence} from '../scripts/corpus-health-freshness.mjs';
const source=fs.readFileSync(new URL('../scripts/check-corpus-health.mjs',import.meta.url),'utf8');
const selection=source.match(/sets=\(await query\(`(WITH versions[\s\S]*?)`,\[DRAFT_RUN_CORPUS_VERSION\]/)?.[1];
const exact=source.match(/sets=\(await query\(`(SELECT s\.set_id[\s\S]*?)`,\s*\[DRAFT_RUN_CORPUS_VERSION,requestedSnapshot\]/)?.[1];
const page=source.match(/const page=\(await query\('([^']+)'/)?.[1];
const filter=source.match(/\.rows\.filter\((s=>!requested\.length\|\|requested\.includes\(s\.set_id\))\)/)?.[1];
assert.ok(selection&&exact&&page&&filter,'Could not locate the real health query literals');
const requestedFilter=new Function('rows','requested',`return rows.filter(${filter});`);
const literal=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
function fixtures({version='fixture-v',gate='fixture-gate',active='historical-a'}={}) {
 return `corpus_set_versions(set_id,corpus_version,manifest) AS (VALUES ('a',${literal(version)},'{}'::jsonb),('b',${literal(version)},'{}'::jsonb)),
 corpus_source_snapshots(source_snapshot_id,set_id,corpus_version,schema_version,lifecycle_status,manifest,created_at) AS (VALUES
 ('historical-a','a',${literal(version)},'historical-frozen','Live','{}'::jsonb,now()-interval '9 days'),
 ('older-a','a',${literal(version)},'v1','Superseded','{}'::jsonb,now()-interval '8 days'),
 ('candidate-a','a',${literal(version)},'v1','Candidate','{}'::jsonb,now()-interval '7 days'),
 ('retired-a','a',${literal(version)},'v1','Retired','{}'::jsonb,now()),
 ('active-b','b',${literal(version)},'v1','Live','{}'::jsonb,now()-interval '7 days'),
 ('other-version','a','not-this-version','v1','Candidate','{}'::jsonb,now())),
 draft_run_environment_policy(set_id,active_snapshot_id,status) AS (VALUES ('a',${literal(active)},'Live'),('b','active-b','Live')),
 draft_run_verified_puzzles(puzzle_id,set_id,corpus_version,source_snapshot_id,payload) AS (VALUES
 ('a0','a',${literal(version)},NULL::text,'{"fixture":"historical"}'::jsonb),
 ('a1','a',${literal(version)},'candidate-a','{"fixture":"candidate"}'::jsonb),
 ('a2','a',${literal(version)},'older-a','{"fixture":"older"}'::jsonb),
 ('b0','b',${literal(version)},NULL::text,'{}'::jsonb),('b1','b',${literal(version)},'active-b','{}'::jsonb),
 ('wrong-version','a','not-this-version',NULL::text,'{}'::jsonb)),
 corpus_health_checks(id,source_snapshot_id,checked_at,ready,manifest_hash,gate_version) AS (VALUES
 (1,'historical-a',now()-interval '10 days',true,md5('{}'),${literal(gate)}),
 (2,'candidate-a',now()-interval '1 day',true,md5('{}'),${literal(gate)}),
 (3,'active-b',now()-interval '10 days',true,md5('{}'),${literal(gate)}))`;
}
function query(sql,params,options) {
 const bound=sql.replace(/\$(\d+)\b/g,(_,n)=>{assert.ok(Number(n)<=params.length);return literal(params[Number(n)-1]);});
 const statement=`WITH ${fixtures(options)}, result AS (${bound}) SELECT coalesce(json_agg(result),'[]'::json)::text FROM result;`;
 const result=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',timeout:15000});
 if(result.error)throw result.error;if(result.status!==0)throw Error(result.stderr.trim());
 return JSON.parse(result.stdout.trim());
}
const ids=rows=>rows.map(r=>r.source_snapshot_id).sort();
const all=query(selection,['fixture-v']);
assert.deepEqual(ids(all),['active-b','candidate-a','historical-a']);
assert.deepEqual(ids(requestedFilter(all,['a'])),['candidate-a','historical-a']);
assert.deepEqual(ids(query(selection,['fixture-v'],{active:'candidate-a'})),['active-b','candidate-a']);
assert.deepEqual(ids(query(selection,['fixture-v'],{active:'older-a'})),['active-b','candidate-a','older-a']);
assert.deepEqual(ids(query(exact,['fixture-v','historical-a'])),['historical-a']);
for(const id of ['retired-a','other-version','missing'])assert.deepEqual(query(exact,['fixture-v',id]),[]);
assert.deepEqual(query(page,['a','fixture-v',null,'']).map(r=>r.puzzle_id),['a0']);
assert.deepEqual(query(page,['a','fixture-v','candidate-a','']).map(r=>r.puzzle_id),['a1']);
assert.deepEqual(query(page,['a','fixture-v','candidate-a','a1']),[]);
// Negative controls execute the formerly broken SQL, proving these fixtures
// would fail before the fix (extra Candidate payload and invalid UNION shape).
const oldPage=page.replace('source_snapshot_id IS NOT DISTINCT FROM $3::text','($3::text IS NULL OR source_snapshot_id=$3)');
assert.deepEqual(query(oldPage,['a','fixture-v',null,'']).map(r=>r.puzzle_id),['a0','a1','a2']);
const oldSelection=selection.replace('SELECT set_id,manifest,source_snapshot_id FROM first_class WHERE rn=1','SELECT * FROM first_class WHERE rn=1').replace('SELECT s.set_id,s.manifest,s.source_snapshot_id FROM corpus_source_snapshots s','SELECT s.* FROM corpus_source_snapshots s');
assert.throws(()=>query(oldSelection,['fixture-v']),/same number of columns/);
let metadataCalls=0;
const rows=await loadHealthEvidenceRows(async(sql,params)=>{
 metadataCalls++;assert.doesNotMatch(sql,/\b(payload|draft_run_verified_puzzles)\b/i,'Metadata report must not touch puzzle payloads');
 return {rows:query(sql,params,{version:params[0],gate:params[1]})};
});
assert.equal(metadataCalls,1);assert.equal(rows.length,3);
const report=classifyHealthEvidence(rows);
assert.equal(report.find(x=>x.source_snapshot_id==='historical-a').state,'live-informational');
assert.equal(report.find(x=>x.source_snapshot_id==='candidate-a').state,'ready');
console.log(JSON.stringify({suite:'corpus_egress_postgres_fixtures',passed:true,live_corpus_rows_read:0,checks:['target UNION and deduplication','requested set filtering','exact historical and Candidate snapshots','retired/missing/version rejection','payload snapshot isolation and cursor','pre-fix negative controls','metadata-only health report']}));
