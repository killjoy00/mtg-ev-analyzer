import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {validateComponents} from './load-traditional-components.mjs';
import {DRAFT_RUN_CORPUS_VERSION as parent} from '../draft-run.mjs';
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
const hash=x=>createHash('sha256').update(JSON.stringify(sorted(x))).digest('hex');
export async function verifyComponents(query,prepared,status=null) {
 for(const s of prepared.filter(s=>s.health.ready)) {
  const v=s.manifest.component_version;
  const row=(await query(`SELECT c.status,v.manifest,p.status parent_status
    FROM corpus_components c JOIN corpus_set_versions v ON v.set_id=c.set_id AND v.corpus_version=c.component_version
    LEFT JOIN draft_run_environment_policy p ON p.set_id=c.set_id
    WHERE c.set_id=$1 AND c.component_version=$2 AND c.parent_version=$3`,[s.sid,v,parent])).rows[0];
  assert.ok(row,s.sid+': component missing');
  if(status==='eligible')assert.equal(row.status,row.parent_status==='Live'?'Live':'Candidate',s.sid+': component lifecycle does not match parent publication eligibility');
  else if(status)assert.equal(row.status,status);
  assert.equal(hash(parse(row.manifest)),hash(s.manifest),s.sid+': immutable artifact differs');
  const n=(await query("SELECT count(*)::int n,count(*) FILTER(WHERE interesting)::int usable,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM draft_run_puzzle_ratings r WHERE r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'))::int unrated FROM draft_run_verified_puzzles p WHERE set_id=$1 AND corpus_version=$2",[s.sid,v])).rows[0];
  assert.equal(Number(n.n),s.health.puzzles);assert.equal(Number(n.usable),s.health.usable_puzzles);assert.equal(Number(n.unrated),0);
  console.log(JSON.stringify({set:s.sid,component:v,status:row.status,parent_status:row.parent_status,puzzles:Number(n.n),usable:Number(n.usable),verified:true}));
 }
}
if(process.argv[1]?.endsWith('/verify-puzzle-components.mjs'))await verifyComponents(corpusDatabase(process.argv[2]),await validateComponents(process.argv[3]),process.argv[4]||null);
