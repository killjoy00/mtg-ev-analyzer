import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';

const guard='./tests/e2e-production-guard.mjs';
const spec=(file,env={})=>({file,env});
const draftRun=[
  spec('tests/draft-run-e2e.mjs'),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_ENVIRONMENT:'powered-cube'}),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_DAILY:'1'}),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_DAILY:'1',PACK1_TEST_ENVIRONMENT:'powered-cube'}),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_DAILY:'1',PACK1_TEST_ENVIRONMENT:'latest'}),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_SELECTION_VERSION:'eight-pick-v3'}),
  spec('tests/draft-run-e2e.mjs',{PACK1_TEST_SELECTION_VERSION:'first-pack-v2'}),
];
export const BROWSER_GROUPS={
  core:[spec('tests/e2e.mjs')],
  sets:[spec('tests/sets-e2e.mjs')],
  practice:[spec('tests/practice-e2e.mjs'),spec('tests/practice-hub-e2e.mjs'),spec('tests/practice-access-e2e.mjs')],
  profile:[spec('tests/profile-e2e.mjs')],
  daily:[spec('tests/e2e.mjs'),spec('tests/home-today-e2e.mjs'),spec('tests/home-auth-hydration-e2e.mjs'),...draftRun.slice(0,5)],
  draft_run:[...draftRun],
  account:[
    spec('tests/account-e2e.mjs'),spec('tests/auth-context-e2e.mjs'),spec('tests/email-verification-e2e.mjs'),
    spec('tests/patreon-activation-e2e.mjs'),spec('tests/password-recovery-e2e.mjs'),spec('tests/credential-management-e2e.mjs'),
    spec('tests/account-deletion-e2e.mjs'),
  ],
  ads:[spec('tests/ads-e2e.mjs')],
  admin:[spec('tests/admin-e2e.mjs'),spec('tests/corpus-readiness-e2e.mjs'),spec('tests/admin-invitations-e2e.mjs')],
};
export const PRESENTATION_BROWSER=[spec('tests/e2e.mjs'),spec('tests/sets-e2e.mjs')];
export const FULL_BROWSER=[
  spec('tests/e2e.mjs'),spec('tests/sets-e2e.mjs'),
  ...BROWSER_GROUPS.practice,...BROWSER_GROUPS.profile,
  spec('tests/home-today-e2e.mjs'),spec('tests/home-auth-hydration-e2e.mjs'),
  ...draftRun,...BROWSER_GROUPS.account,...BROWSER_GROUPS.ads,...BROWSER_GROUPS.admin,
];

const key=test=>test.file+'\0'+JSON.stringify(Object.entries(test.env).sort());
export function selectedBrowserTests({full=false,presentation=false,groups=[]}={}) {
  const selected=full?FULL_BROWSER:presentation?PRESENTATION_BROWSER:groups.flatMap(group=>{
    if(!BROWSER_GROUPS[group])throw new Error(`Unknown browser group: ${group}`);
    return BROWSER_GROUPS[group];
  });
  const seen=new Set();
  return selected.filter(test=>{const id=key(test);if(seen.has(id))return false;seen.add(id);return true;});
}

export function runBrowserTests(selection,{spawn=spawnSync}={}) {
  const tests=selectedBrowserTests(selection);
  if(!tests.length)throw new Error('Browser test selection is empty.');
  const records=[],started=Date.now();
  mkdirSync('artifacts/browser',{recursive:true});
  const summary=()=>writeFileSync('artifacts/browser/report.json',JSON.stringify({source_sha:process.env.GITHUB_SHA||null,expected:tests.length,executed:records.length,duration_ms:Date.now()-started,records},null,2));
  for(const test of tests) {
    console.log(`Browser: ${test.file}${Object.keys(test.env).length?' '+JSON.stringify(test.env):''}`);
    const id=`${records.length}-${test.file.split('/').at(-1).replace(/\.mjs$/,'')}`,before=Date.now();
    const result=spawn(process.execPath,['--import',guard,test.file],{stdio:'inherit',timeout:180000,env:{...process.env,...test.env,PACK1_E2E_ARTIFACT_ID:id}});
    records.push({...test,status:result.status===0?'passed':'failed',duration_ms:Date.now()-before,signal:result.signal||null});summary();
    if((result.status??1)!==0)process.exit(result.status??1);
    // Retain detailed traces for failures; successful contract screenshots
    // created by the scripts themselves remain in artifacts/ as before.
    rmSync(`artifacts/browser/${id}`,{recursive:true,force:true});
  }
  summary();
  return tests.length;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  const full=args.includes('--full');
  const presentation=args.includes('--presentation');
  const groupArg=args[args.indexOf('--groups')+1];
  const groups=groupArg&&args.includes('--groups')?groupArg.split(',').filter(Boolean):[];
  const count=runBrowserTests({full,presentation,groups});
  console.log(`Completed ${count} selected browser invocation(s).`);
}
