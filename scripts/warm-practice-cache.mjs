// Guarded release/publication entrypoint. Never changes corpus lifecycle state.
import {mkdir,writeFile} from 'node:fs/promises';
import {query} from '../worker/growth-function.js';
import {registerServingReadiness,advanceServingReadiness,readServingReadiness} from '../worker/corpus-readiness.mjs';
const started=Date.now(),deadline=started+8*60*1000;
const release=process.env.PACK1_RELEASE_COMMIT||process.env.GITHUB_SHA||'local';
const inspect=process.argv.includes('--inspect');
if(!inspect)await registerServingReadiness(query);
let status;
while(true) {
 status=inspect?await readServingReadiness(query):await advanceServingReadiness(query,{release});
 if(status.ready||inspect||status.state==='failed'||Date.now()>=deadline)break;
 await new Promise(resolve=>setTimeout(resolve,2000));
}
const evidence={operation:'practice-cache-readiness',release,ms:Date.now()-started,...status};
await mkdir('artifacts/corpus-readiness',{recursive:true});
await writeFile(`artifacts/corpus-readiness/${started}-${inspect?'inspect':'warmup'}.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
if(!status.ready||!status.current)throw Error(`Current serving revision is not ready (${status.state}); activation was not rolled back. Inspect operation ${status.operation_id||'unavailable'}.`);
