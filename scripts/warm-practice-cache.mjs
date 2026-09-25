// Prewarm once after publication/migrations; this does not prevent scale-to-zero.
import {query} from '../worker/growth-function.js';
import {loadServingSnapshot,servingRevisionMatches} from '../worker/draft-run-selection.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
const started=performance.now();
const snapshot=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
if(!await servingRevisionMatches(query,snapshot.revision))throw Error('Serving inputs changed during warmup.');
console.log(JSON.stringify({operation:'practice-cache-warmup',revision:snapshot.revision,groups:snapshot.groups.length,ms:Math.round(performance.now()-started)}));
