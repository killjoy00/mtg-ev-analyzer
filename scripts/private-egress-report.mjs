import {pathToFileURL} from 'node:url';
import {privateStore,publicFailureCode} from './private-compute-report.mjs';
import {collectEvidence} from './neon-egress-evidence.mjs';

export async function runPrivateEgress({neonKey,cloudflareToken,runId,attempt,sha,now=Date.now(),fetcher=fetch}={}) {
 if(!neonKey||!/^\d+$/.test(runId||'')||!/^\d+$/.test(attempt||'')||!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Trusted collection context unavailable');
 const storage=privateStore({token:cloudflareToken,fetcher});await storage.verify();
 const previous=await storage.optional('egress-history/latest.json');
 const report=await collectEvidence({key:neonKey,fetcher,now,clock:()=>new Date(now).toISOString(),previous,since:'2026-09-25T19:42:23Z'});
 report.source_revision=sha;report.source_run_id=runId;report.source_run_attempt=attempt;
 // The immutable run copy is verified before updating the comparison pointer.
 await storage.save(`egress-history/${runId}-${attempt}/report.json`,report);
 await storage.save('egress-history/latest.json',report);
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 try {
   if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Reviewed main required');
   await runPrivateEgress({neonKey:process.env.NEON_API_KEY,cloudflareToken:process.env.CLOUDFLARE_EDGE_TOKEN,
     runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,sha:process.env.GITHUB_SHA});
   console.log('Private egress evidence and comparison pointer saved and readback verified. No usage details were published.');
 } catch(error) {console.error('Private egress evidence failed ('+publicFailureCode(error)+'). No usage details or credentials were published.');process.exitCode=1;}
}
