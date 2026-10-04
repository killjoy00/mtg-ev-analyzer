import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const LOAD_SENSITIVE_PATHS=[
  path=>path.startsWith('scripts/launch-distributed'),
  path=>path==='worker/draft-start-timing.mjs',
  path=>path==='worker/draft-run-function.mjs',
  path=>path==='worker/draft-run-selection.mjs',
  path=>path==='migrations/0045_batched_practice_selector.sql',
  path=>path==='migrations/0050_practice_recency_bias.sql',
  path=>path==='migrations/0051_exact_pick_draw_index.sql',
  path=>path==='scripts/edge-control.mjs',
];

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
  } catch {
    // Fail safe: an unreadable or unclassifiable diff gets the full rehearsal.
    console.log('run_load=true');
    console.log('reason=scope_error');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
