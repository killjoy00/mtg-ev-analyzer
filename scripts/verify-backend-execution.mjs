import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {backendExecutionPlan,loadBackendMap} from './backend-gate-scope.mjs';

// Draft PRs defer Neon branches until ready_for_review reruns this gate. The
// gate still fails, so a draft never carries a passing check without them.
const deferredError=domains=>Error(`Neon domains deferred while this PR is a draft (${domains.join(', ')}). Mark it ready for review to run them.`);
export function verifyBackendExecution({precheck,postgres,neon,full,domains,neonDomains,draft=false},map=loadBackendMap()) {
  assert.equal(postgres,'success','Real PostgreSQL contracts, including the complete account domain, must pass');
  const all=Object.keys(map.domains);
  if(precheck!=='success') {
    if(draft&&neon==='skipped')throw deferredError(['full fallback']);
    assert.equal(neon,'success','Missing classification requires the full Neon fallback');return;
  }
  assert.ok(typeof full==='boolean'&&Array.isArray(domains)&&domains.length>0&&
    domains.every(domain=>all.includes(domain))&&new Set(domains).size===domains.length,'Invalid backend domain classification');
  if(full)assert.deepEqual([...domains].sort(),[...all].sort(),'Full backend routing omitted a domain');
  const plan=backendExecutionPlan({fullSuite:full,domains},map);
  assert.deepEqual(neonDomains,plan.neonDomains,'Neon routing disagrees with the validated domain classification');
  if(draft&&plan.neonDomains.length&&neon==='skipped')throw deferredError(plan.neonDomains);
  assert.equal(neon,plan.neonDomains.length?'success':'skipped','Required Neon domains must pass; only account-only scope can skip');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const env=process.env;
  try {
    verifyBackendExecution({precheck:env.PRECHECK_RESULT,postgres:env.POSTGRES_RESULT,neon:env.DOMAIN_RESULT,
      full:env.BACKEND_FULL==='true',draft:env.PR_DRAFT==='true',domains:JSON.parse(env.DOMAINS_JSON||'[]'),neonDomains:JSON.parse(env.NEON_DOMAINS_JSON||'[]')});
    console.log('All required local PostgreSQL and isolated Neon domains succeeded.');
  } catch(error){console.error(error.message);process.exitCode=1;}
}
