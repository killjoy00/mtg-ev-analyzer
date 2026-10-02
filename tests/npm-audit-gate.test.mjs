import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditGate} from '../.github/scripts/npm-audit-gate.mjs';

const advisory=(name,severity,ghsa)=>({source:1,name,dependency:name,title:'t',url:`https://github.com/advisories/${ghsa}`,severity,range:'*'});
const report=(...vias)=>({vulnerabilities:Object.fromEntries(vias.map(via=>[via.name,{name:via.name,severity:via.severity,via:[via]}]))});
const exceptions=new Map([['GHSA-aaaa-bbbb-cccc','2026-12-01']]);

test('a listed advisory is excepted until its date and blocks after it',()=>{
  const forge=report(advisory('node-forge','high','GHSA-aaaa-bbbb-cccc'));
  assert.deepEqual(auditGate(forge,{today:'2026-12-01',exceptions}).blocking,[]);
  assert.equal(auditGate(forge,{today:'2026-12-01',exceptions}).excepted.length,1);
  assert.deepEqual(auditGate(forge,{today:'2026-12-02',exceptions}).blocking,['GHSA-aaaa-bbbb-cccc (node-forge)']);
});

test('any other high or critical advisory still blocks',()=>{
  const mixed=report(advisory('node-forge','high','GHSA-aaaa-bbbb-cccc'),advisory('left-pad','critical','GHSA-dddd-eeee-ffff'));
  assert.deepEqual(auditGate(mixed,{today:'2026-10-02',exceptions}).blocking,['GHSA-dddd-eeee-ffff (left-pad)']);
});

test('moderate advisories and transitive name-only entries do not block',()=>{
  const moderate=report(advisory('tar','moderate','GHSA-gggg-hhhh-iiii'));
  moderate.vulnerabilities.expo={name:'expo',severity:'high',via:['@expo/cli']};
  assert.deepEqual(auditGate(moderate,{today:'2026-10-02',exceptions}).blocking,[]);
});

test('a failed or unreadable audit blocks',()=>{
  assert.equal(auditGate(null).blocking.length,1);
  assert.equal(auditGate({error:{code:'ENOAUDIT'}}).blocking.length,1);
});

test('the dependency workflow routes the runtime audit through the gate',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/dependency-security.yml',import.meta.url),'utf8');
  assert.match(workflow,/node \.\.\/\.github\/scripts\/npm-audit-gate\.mjs "\$RUNNER_TEMP\/dependency-audit\/mobile-runtime\.json"\n\s+status=\$\?/);
});
