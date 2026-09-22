// Offline administrative release only. No new public API accepts workflow identity.
import {refreshSourceStatistics} from '../worker/serving-statistics.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {validateComponents} from './load-traditional-components.mjs';
import {verifyComponents} from './verify-puzzle-components.mjs';
import {verifyCorpusPublicationToken,CORPUS_PUBLICATION_AUDIENCE} from '../worker/trophy-import-auth.mjs';
import {handleCorpusAdmin} from '../worker/corpus-admin.mjs';
import {DRAFT_RUN_CORPUS_VERSION as parent} from '../draft-run.mjs';
const query=corpusDatabase(process.argv[2]),prepared=await validateComponents(process.argv[3]);
const endpoint=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);endpoint.searchParams.set('audience',CORPUS_PUBLICATION_AUDIENCE);
const r=await fetch(endpoint,{headers:{authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(10000)});
if(!r.ok)throw Error('Administrative workflow identity unavailable');
const identity=await verifyCorpusPublicationToken((await r.json()).value);
await verifyComponents(query,prepared);
const live=[],pending=[];
for(const s of prepared.filter(s=>s.health.ready)) {
 const component=s.manifest.component_version;
 const row=(await query('SELECT status FROM corpus_components WHERE set_id=$1 AND component_version=$2',[s.sid,component])).rows[0];
 if(!row)throw Error(s.sid+': reviewed Candidate is missing');
 if(row.status==='Live'){console.log(s.sid+': already Live with identical verified artifact');live.push(s);continue;}
 if(row.status!=='Candidate')throw Error('Publication only accepts reviewed Candidates');
 const parentStatus=(await query('SELECT status FROM draft_run_environment_policy WHERE set_id=$1',[s.sid])).rows[0]?.status;
 if(parentStatus!=='Live') {
  console.log(JSON.stringify({set:s.sid,component,status:'Candidate',publication:'deferred',reason:'Parent environment is not Live'}));
  pending.push(s);continue;
 }
 const result=await handleCorpusAdmin(new Request(`https://packone.pro/v1/admin/corpus/${s.sid}/components/${component}/status`,{method:'POST'}),query,async()=>({oldStatus:'Candidate',status:'Live',corpusVersion:parent,reason:'Owner-authorized puzzle-source expansion; frozen Premier grader unchanged. Reviewed publication '+identity.run_id}),null,identity);
 console.log(JSON.stringify(result));live.push(s);
}
await verifyComponents(query,live,'Live');
await verifyComponents(query,pending,'Candidate');

await refreshSourceStatistics(query);
