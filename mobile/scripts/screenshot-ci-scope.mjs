import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function needsNativeScreenshots(paths,{packageBefore,packageAfter}={}) {
  if(!paths.length)return true;
  for(const path of paths) {
    if(/^mobile\/tests\//.test(path)||/^docs\//.test(path)||path==='.github/actions/mobile-validate/action.yml'||path==='mobile/scripts/run-unit-tests.mjs')continue;
    if(path==='mobile/package.json'&&packageBefore&&packageAfter) {
      const before={...packageBefore},after={...packageAfter};delete before.scripts;delete after.scripts;
      if(JSON.stringify(before)===JSON.stringify(after))continue;
    }
    if(path.startsWith('mobile/')||path==='.github/workflows/mobile-store-screenshots.yml')return true;
  }
  return false;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  let required=true;
  try {
    const [base,head]=process.argv.slice(2);
    if(!/^[a-f0-9]{40}$/.test(base)||!/^[a-f0-9]{40}$/.test(head))throw Error('Invalid diff');
    const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
    const paths=git('diff','--name-only',base,head).trim().split('\n').filter(Boolean);
    required=needsNativeScreenshots(paths,{packageBefore:JSON.parse(git('show',base+':mobile/package.json')),packageAfter:JSON.parse(git('show',head+':mobile/package.json'))});
  } catch { /* Unreadable diffs must retain native coverage. */ }
  console.log('capture_required='+required);
}
