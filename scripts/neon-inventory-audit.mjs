import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

// Read-only Neon inventory audit (#805). Production identity is the explicit
// serving branch ID, never Neon's default-branch label; this audit fails if the
// two diverge, if production runs Functions nobody owns, or if a temporary
// branch has no expiry.
export const PROJECT='patient-shadow-91417882';
export const PROD_BRANCH='br-orange-feather-ayps8kep';
export const LONG_LIVED_BRANCHES=new Map([
  [PROD_BRANCH,'production'],
  ['br-twilight-hill-ayffyd2b','development/QA'],
]);

// Unmanaged helper Functions found on production on 2026-09-30 (#805). Each
// must be deleted or adopted into .github/neon-functions.txt by the review date;
// after it they fail the audit like any other unowned Function.
export const UNMANAGED_FUNCTION_REVIEW_BY='2026-10-15T00:00:00Z';
// dringest was invoked on 2026-09-26 by an unidentified caller; the other dr* helpers were deleted on 2026-10-01.
export const KNOWN_UNMANAGED_FUNCTIONS=new Set(['dringest']);

export function manifestSlugs(text) {
  return String(text||'').trim().split('\n').map(line=>line.trim().split(':')[0]).filter(Boolean);
}

export function auditInventory({functions,branches,manifest,now=new Date()}) {
  const problems=[],warnings=[];
  const deployed=functions.map(fn=>fn.slug);
  const managed=new Set(manifest);
  const reviewOpen=now.getTime()<Date.parse(UNMANAGED_FUNCTION_REVIEW_BY);
  for(const slug of deployed) {
    if(managed.has(slug))continue;
    if(KNOWN_UNMANAGED_FUNCTIONS.has(slug)&&reviewOpen)warnings.push(`unmanaged Function ${slug} (decide by ${UNMANAGED_FUNCTION_REVIEW_BY})`);
    else problems.push(`unmanaged Function ${slug} is not in .github/neon-functions.txt`);
  }
  for(const slug of managed)if(!deployed.includes(slug))problems.push(`managed Function ${slug} is missing from production`);
  const defaults=branches.filter(branch=>branch.default);
  if(defaults.length!==1||defaults[0].id!==PROD_BRANCH)problems.push(`Neon default branch is ${defaults.map(b=>b.id).join(',')||'unset'}, not ${PROD_BRANCH}`);
  for(const branch of branches) {
    if(LONG_LIVED_BRANCHES.has(branch.id)||branch.expires_at)continue;
    problems.push(`branch ${branch.id} has no expiry and is not a declared long-lived branch`);
  }
  for(const id of LONG_LIVED_BRANCHES.keys())if(!branches.some(branch=>branch.id===id))problems.push(`declared long-lived branch ${id} is missing`);
  return {problems,warnings,functions:deployed.length,branches:branches.length};
}

// Guard reads only control-plane metadata; it must never mutate Neon state.
async function control(route,{key=process.env.NEON_API_KEY,fetcher=fetch}={}) {
  if(typeof key!=='string'||key.length<20)throw Error('NEON_API_KEY is missing or too short.');
  const response=await fetcher('https://console.neon.tech/api/v2'+route,{
    method:'GET',
    headers:{authorization:'Bearer '+key,accept:'application/json'},
    redirect:'error',
    signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw Error('Neon inventory read failed with HTTP '+response.status+'.');
  return response.json();
}

export async function runInventoryAudit({
  key=process.env.NEON_API_KEY,
  fetcher=fetch,
  manifestText=fs.readFileSync(new URL('../.github/neon-functions.txt',import.meta.url),'utf8'),
  now=new Date(),
}={}) {
  const [functionBody,branchBody]=await Promise.all([
    control('/projects/'+PROJECT+'/branches/'+PROD_BRANCH+'/functions',{key,fetcher}),
    control('/projects/'+PROJECT+'/branches',{key,fetcher}),
  ]);
  if(!Array.isArray(functionBody?.functions)||!Array.isArray(branchBody?.branches))throw Error('Neon returned an unexpected inventory.');
  return auditInventory({functions:functionBody.functions,branches:branchBody.branches,manifest:manifestSlugs(manifestText),now});
}

async function main() {
  const result=await runInventoryAudit();
  console.log('NEON_INVENTORY_AUDIT '+JSON.stringify(result));
  for(const warning of result.warnings)console.log('::warning::'+warning);
  for(const problem of result.problems)console.log('::error::'+problem);
  if(result.problems.length)process.exitCode=1;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{
    console.error(String(error?.message||'Neon inventory audit failed.'));
    process.exitCode=1;
  });
}
