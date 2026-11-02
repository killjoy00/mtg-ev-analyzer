// Guarded release/publication entrypoint. Never changes corpus lifecycle state.
import {mkdir,writeFile} from 'node:fs/promises';
import {query} from '../worker/growth-function.js';
import {registerServingReadiness,readServingReadiness,awaitServingReadiness} from '../worker/corpus-readiness.mjs';
const started=Date.now();
const release=process.env.PACK1_RELEASE_COMMIT||process.env.GITHUB_SHA||'local';
const inspect=process.argv.includes('--inspect');
if(!inspect)await registerServingReadiness(query);
const status=inspect?await readServingReadiness(query):await awaitServingReadiness(query,{release,deadlineMs:8*60*1000,pollMs:2000});
const evidence={operation:'practice-cache-readiness',release,ms:Date.now()-started,...status};
await mkdir('artifacts/corpus-readiness',{recursive:true});
await writeFile(`artifacts/corpus-readiness/${started}-${inspect?'inspect':'warmup'}.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
if(!status.ready||!status.current)throw Error(`Current serving revision is not ready (${status.state}); activation was not rolled back. Inspect operation ${status.operation_id||'unavailable'}.`);
