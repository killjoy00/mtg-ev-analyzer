import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const LOAD_SENSITIVE_PATHS=[
  path=>path==='.github/scripts/maintain-serving-indexes.sql',
  path=>path==='scripts/ci-migration-plan.mjs',
  path=>path==='scripts/require-ci-source.mjs',
  path=>path==='.github/workflows/launch-distributed-preview.yml',
  path=>path.startsWith('scripts/launch-distributed'),
  path=>path==='worker/draft-start-timing.mjs',
  path=>path==='worker/draft-run-function.mjs',
  path=>path==='worker/draft-run-selection.mjs',
  path=>path==='migrations/0045_batched_practice_selector.sql',
  path=>path==='migrations/0050_practice_recency_bias.sql',
  path=>path==='migrations/0051_exact_pick_draw_index.sql',
  path=>path==='migrations/0056_snapshot_aware_reroll_covering_index.sql',
  path=>path==='scripts/edge-control.mjs',
  path=>path==='scripts/create-ci-neon-branch.mjs',
  path=>path==='scripts/control-read.mjs',
  path=>path==='.github/preview-dns-recovery.json',
];
const PRACTICE_PERFORMANCE_PATHS=new Set([
  'scripts/practice-performance.mjs',
  'scripts/practice-reroll-performance.mjs',
  'scripts/practice-draw-performance.mjs',
  'scripts/practice-cache-publication.mjs',
  'worker/draft-run-selection.mjs',
  'migrations/0039_practice_serving_cache.sql',
  'migrations/0045_batched_practice_selector.sql',
  'migrations/0050_practice_recency_bias.sql',
  'migrations/0051_exact_pick_draw_index.sql',
  'tests/practice-performance.test.mjs',
  '.github/workflows/practice-performance.yml',
]);
export function requiresPracticePerformance(files=[]) {
  return [...new Set(files.filter(Boolean))].some(path=>PRACTICE_PERFORMANCE_PATHS.has(path));
}

function changedPatchLines(patch) {
  return String(patch||'').split('\n')
    .filter(line=>(line.startsWith('+')||line.startsWith('-'))&&!line.startsWith('+++')&&!line.startsWith('---'))
    .map(line=>line.slice(1).trim());
}

export function adminOnlyGatewayPatch(patch) {
  const lines=changedPatchLines(patch);
  if(!lines.length)return false;
  return lines.every(line=>{
    if(!line||line.startsWith('//'))return true;
    const normalized=line.replaceAll('\\','');
    if(!normalized.includes('/admin/')||normalized.includes('||'))return false;
    if(/^if\(.+\)return true;$/.test(normalized))return true;
    return /^if\(path===['"]\/(?:growth|draft)\/v1\/admin\/[^'"]+['"]\)return ['"]admin_[a-z0-9_]+['"];$/.test(normalized);
  });
}

export function classifyLaunchChange({files,gatewayPatch=''}) {
  const names=[...new Set((files||[]).filter(Boolean))];
  const sensitive=names.filter(path=>LOAD_SENSITIVE_PATHS.some(match=>match(path)));
  if(sensitive.length)return {runLoad:true,reason:'capacity_path'};
  if(names.includes('edge/gateway.mjs')) {
    if(adminOnlyGatewayPatch(gatewayPatch))return {runLoad:false,reason:'admin_only_gateway'};
    return {runLoad:true,reason:'shared_or_gameplay_gateway'};
  }
  return {runLoad:false,reason:'meta_or_test_only'};
}

function git(...args) {
  return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trimEnd();
}

function main() {
  const [base,head]=process.argv.slice(2);
  try {
    if(!/^[a-f0-9]{40}$/.test(base||'')||!/^[a-f0-9]{40}$/.test(head||''))throw Error('invalid_sha');
    const files=git('diff','--name-only','--diff-filter=ACMR',base,head,'--').split('\n').filter(Boolean);
    const gatewayPatch=files.includes('edge/gateway.mjs')?git('diff','--unified=0',base,head,'--','edge/gateway.mjs'):'';
    const result=classifyLaunchChange({files,gatewayPatch});
    console.log('run_load='+(result.runLoad?'true':'false'));
    console.log('reason='+result.reason);
    console.log('require_performance='+(requiresPracticePerformance(files)?'true':'false'));
  } catch {
    // Fail safe: an unreadable or unclassifiable diff gets the full rehearsal.
    console.log('run_load=true');
    console.log('reason=scope_error');
    console.log('require_performance=true');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
