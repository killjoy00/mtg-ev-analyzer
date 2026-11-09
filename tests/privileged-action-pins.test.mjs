import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';

// Frozen, independently verified upstream commit hashes for GitHub Actions
// with access to provider credentials or privileged emulation/build runners.
const pins=Object.freeze({
  'google-github-actions/auth':'7c6bc770dae815cd3e89ee6cdf493a5fab2cc093',
  'google-github-actions/setup-gcloud':'aa5489c8933f4cc7a4f7d45035b3b1440c9c10db',
  'neondatabase/create-branch-action':'fb620d43d4c565abaf088b848a4e28e5c4ea4d9c',
  'neondatabase/delete-branch-action':'4468d825d5a88ef4012f1705a82f02ec3072f776',
  'reactivecircus/android-emulator-runner':'a421e43855164a8197daf9d8d40fe71c6996bb0d',
  'devcontainers/ci':'513af61f4de4f75d37e4438f184ba4358f0fc1ca',
});

test('privileged third-party GitHub Actions remain pinned to immutable commit SHAs',()=>{
  const seen=new Set();
  for(const name of readdirSync('.github/workflows').filter(name=>/\.ya?ml$/.test(name))) {
    const text=readFileSync('.github/workflows/'+name,'utf8');
    for(const [,action,ref] of text.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s@]+)@([^\s#]+)/gm)) {
      if(!Object.hasOwn(pins,action))continue;
      seen.add(action);
      assert.equal(ref,pins[action],name+' uses an unreviewed or mutable '+action+' version');
    }
  }
  for(const action of Object.keys(pins))assert.ok(seen.has(action),action+' should be exercised by a workflow');
});
