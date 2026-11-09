import {createHash} from 'node:crypto';

export const PRIVILEGED_ACTION_PINS=Object.freeze({
  'google-github-actions/auth':'7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',
  'google-github-actions/setup-gcloud':'aa5489c8933f4cc7a4f7d45035b3b1440c9c10db',
  'neondatabase/create-branch-action':'fb620d43d4c565abaf088b848a4e28e5c4ea4d9c',
  'neondatabase/delete-branch-action':'4468d825d5a88ef4012f1705a82f02ec3072f776',
  'reactivecircus/android-emulator-runner':'a421e43855164a8197daf9d8d40fe71c6996bb0d',
  'devcontainers/ci':'513af61f4de4f75d37e4438f184ba4358f0fc1ca',
});

// The completed 100963 import's self-push trigger must NOT be edited: editing
// it launches a guaranteed-to-fail main workflow. PR #1513 removes it.
// Until that PR merges, the file is exempted ONLY if its bytes are untouched.
// A new third-party tag, even inside that workflow, fails this hash check.
const RETIRED_IMPORT='.github/workflows/android-upload-existing-aab.yml';
const RETIRED_IMPORT_BLOB='8aa32266715ac7d804bb14399df5b87c454f5d47';

export function auditActionPins(source,path) {
  if(path===RETIRED_IMPORT) {
    const hash=createHash('sha1').update('blob '+Buffer.byteLength(source)+'\0').update(source).digest('hex');
    return hash===RETIRED_IMPORT_BLOB?[]:[path+': obsolete one-time import workflow was edited; delete it via PR #1513'];
  }
  const errors=[];
  const actionRef=/^\s*(?:-\s*)?uses:\s*['"]?([^\s'"#]+)['"]?/gm;
  for(const match of source.matchAll(actionRef)) {
    const whole=match[1];
    if(whole.startsWith('./')||whole.startsWith('docker://'))continue;
    const split=whole.lastIndexOf('@');
    if(split<1){errors.push(path+': Action missing an immutable ref: '+whole);continue;}
    const action=whole.slice(0,split),ref=whole.slice(split+1);
    // Official GitHub-maintained actions/* are a separate, tracked hardening
    // project; ALL other external publishers must be immutable now.
    if(!action.startsWith('actions/')&&!/^[a-f0-9]{40}$/.test(ref))
      errors.push(path+': third-party Action must use a full commit SHA: '+whole);
    if(Object.hasOwn(PRIVILEGED_ACTION_PINS,action)&&ref!==PRIVILEGED_ACTION_PINS[action])
      errors.push(path+': privileged Action must match reviewed SHA: '+whole);
  }
  return errors;
}
