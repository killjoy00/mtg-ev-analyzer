import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCustomSetMetadata} from '../worker/draft-run-selection.mjs';
import {registerHealthyCandidate} from '../scripts/corpus-candidate.mjs';
test('custom choices require every decision while preserving mixed Live eligibility',async()=>{
 const sets=['complete','missing-opening','missing-hard'];
 const metadata=sets.map(set_id=>({set_id,regular_run:true,status:'Live',release_date:'2026-01-01'}));
 const coverage=sets.flatMap(set_id=>Array.from({length:8},(_,i)=>i+1).flatMap(pick_number=>['medium','hard'].map(band=>({set_id,pick_number,band,sources:20})))).filter(g=>!(g.set_id==='missing-opening'&&g.pick_number===1)&&!(g.set_id==='missing-hard'&&g.pick_number===8&&g.band==='hard'));
 const query=async sql=>({rows:sql.includes('HAVING')?coverage:metadata});
 assert.deepEqual((await loadCustomSetMetadata(query,'version','2026-09-18')).map(s=>s.set_id),['complete']);
 assert.equal(metadata.length,3);
});
test('Candidate registration requires current complete health and never changes existing states',async()=>{
 let statement,args;await registerHealthyCandidate(async(sql,p)=>{statement=sql;args=p;return {rows:[]};},'new-set','hash');
 assert.match(statement,/h.ready/);assert.match(statement,/md5\(v.manifest::text\)=\$3/);assert.match(statement,/s.import_status='complete'/);assert.match(statement,/ON CONFLICT\(set_id\) DO NOTHING/);assert.equal(args[0],'new-set');
});

test('historical snapshot health scans retained NULL-snapshot puzzle rows',()=>{
 const source=fs.readFileSync(new URL('../scripts/check-corpus-health.mjs',import.meta.url),'utf8');
 assert.match(source,/const puzzleSnapshotId=historical\?null:/);
 assert.match(source,/DRAFT_RUN_CORPUS_VERSION,puzzleSnapshotId,after/);
});
