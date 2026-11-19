import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PRIVILEGED_ACTION_PINS,auditActionPins} from './support/privileged-action-pins.mjs';

function* actionDefinitions(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const pathname=join(dir,entry.name);
    if(entry.isDirectory()) yield* actionDefinitions(pathname);
    else if(/\.ya?ml$/.test(entry.name))yield pathname;
  }
}

test('every third-party Action in workflows or composite actions uses a commit SHA',()=>{
  const violations=[];
  const sources=[...actionDefinitions('.github/workflows'),...actionDefinitions('.github/actions')];
  const seen=new Set();
  for(const file of sources) {
    const source=readFileSync(file,'utf8');
    violations.push(...auditActionPins(source,file.replaceAll('\\','/')));
    for(const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*['"]?([^\s'"#]+)['"]?/gm))
      seen.add(match[1].split('@')[0]);
  }
  assert.deepEqual(violations,[],'Unpinned or unexpected third-party Actions');
  for(const action of Object.keys(PRIVILEGED_ACTION_PINS))
    assert.ok(seen.has(action),action+' should remain covered by a workflow');
});

test('new mutable third-party Actions, reviewed SHA drift and edited one-offs fail closed',()=>{
  assert.deepEqual(auditActionPins('steps:\n  - uses: outside/action@v1\n','new.yml').length,1);
  assert.deepEqual(auditActionPins('steps:\n  - uses: outside/action@'+'a'.repeat(40)+'\n','new.yml'),[]);
  assert.deepEqual(auditActionPins('steps:\n  - uses: ./.github/actions/mobile-validate\n','new.yml'),[]);
  assert.deepEqual(auditActionPins('steps:\n  - uses: actions/checkout@v4\n','new.yml'),[]);
  assert.ok(auditActionPins('steps:\n  - uses: google-github-actions/auth@'+'a'.repeat(40)+'\n','new.yml').length);
  assert.ok(auditActionPins('steps:\n  - uses: other/action@v2\n','.github/workflows/android-upload-existing-aab.yml').length);
});
