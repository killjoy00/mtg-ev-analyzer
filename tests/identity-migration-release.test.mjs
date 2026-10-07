import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('both secure release environments execute fail-closed 0046 and 0054 replay guards',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'identity-release-'));
  const log=path.join(directory,'calls');
  fs.writeFileSync(path.join(directory,'psql'),`#!/bin/bash
printf '%s\\n' "$*" >> "$PSQL_LOG"
if [[ "$*" == *"to_regprocedure"* ]]; then
  [[ "$PSQL_MARKER" == error ]] && exit 7
  printf '%s\\n' "$PSQL_MARKER"
fi
`,{mode:0o755});
  try {
    const workflow=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
    for(const environment of ['development','production']) {
      const block=workflow.split(`- name: Apply additive secure-${environment==='development'?'session':'account'} schema to ${environment}`)[1]?.split('\n      - name:')[0];
      assert.ok(block,environment+' schema step exists');
      for(const migration of ['0046_public_identity_safety.sql','0054_creator_event_idempotency.sql']) {
        const command=block.split('\n').map(x=>x.trim()).find(x=>x.includes('migrations/'+migration));
        assert.ok(command,environment+' contains the identity migration command');
        for(const marker of ['t','f','error','invalid']) {
          fs.writeFileSync(log,'');
          const result=spawnSync('bash',['-c','connection=fixture\n'+command],{encoding:'utf8',env:{...process.env,PATH:directory+':'+process.env.PATH,PSQL_MARKER:marker,PSQL_LOG:log}});
          assert.equal(result.status,marker==='error'?7:marker==='invalid'?1:0,environment+' '+marker);
          const migrations=fs.readFileSync(log,'utf8').split('\n').filter(x=>x.includes(' -f '));
          assert.equal(migrations.length,marker==='f'?1:0,environment+' '+marker+' replay count');
        }
      }
    }
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
