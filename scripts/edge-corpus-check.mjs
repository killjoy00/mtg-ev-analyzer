// Read-only predeployment use of the real health handler against the disposable
// branch's DATABASE_URL. Do not bypass its exact catalog or rating requirements.
import draft from '../worker/draft-run-function.mjs';
const response=await draft.fetch(new Request('https://preview-check.invalid/health'));
const health=await response.json();
console.log(JSON.stringify({status:response.status,sets:health.sets,unrated_puzzles:health.unrated_puzzles,missing_set_count:Array.isArray(health.missing_sets)?health.missing_sets.length:null}));
if(response.status!==200||health.ok!==true)throw Error('Preview corpus health failed before function deployment.');
