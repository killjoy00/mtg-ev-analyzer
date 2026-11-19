import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectTrackedJavaScript,listTrackedJavaScript,checkTrackedJavaScript} from '../scripts/check-tracked-js-syntax.mjs';

const git=(cwd,args)=>{
  const result=spawnSync('git',args,{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
};

async function withRepository(fn) {
  const cwd=mkdtempSync(join(tmpdir(),'pack1-tracked-syntax-'));
  try {
    git(cwd,['init','-q']);
    mkdirSync(join(cwd,'nested'),{recursive:true});
    mkdirSync(join(cwd,'.github','scripts'),{recursive:true});
    mkdirSync(join(cwd,'generated'),{recursive:true});
    writeFileSync(join(cwd,'nested','newly-added.mjs'),'export const newSource=7;\n');
    writeFileSync(join(cwd,'.github','scripts','helper.cjs'),'module.exports=1;\n');
    writeFileSync(join(cwd,'root.js'),'const x=1;\n');
    writeFileSync(join(cwd,'generated','asset.js'),'const bundled=true;\n');
    writeFileSync(join(cwd,'README.md'),'test\n');
    git(cwd,['add','nested/newly-added.mjs','.github/scripts/helper.cjs','root.js','generated/asset.js','README.md']);
    writeFileSync(join(cwd,'untracked.js'),'BROKEN(()\n');
    return await fn(cwd);
  } finally {rmSync(cwd,{recursive:true,force:true});}
}

test('null-delimited Git index discovers nested source and newly tracked JS, not runtime bundles',()=>{
  const parsed=selectTrackedJavaScript([
    'root.js','.github/scripts/helper.cjs','nested/newly-added.mjs',
    'generated/asset.js','artifacts/output.js','data/cache.mjs',
    'node_modules/lib.js','README.md','schema.json',
  ].join('\0')+'\0');
  assert.deepEqual(parsed,['.github/scripts/helper.cjs','nested/newly-added.mjs','root.js']);
  assert.throws(()=>selectTrackedJavaScript('root.js\n'),/missing or incomplete/);
  assert.throws(()=>selectTrackedJavaScript('\0'),/invalid file name/);
  assert.throws(()=>selectTrackedJavaScript('README.md\0'),/No tracked/);
});

test('real Git index includes new tracked file without requiring a hand-maintained list',async()=>{
  await withRepository(cwd=>{
    const files=listTrackedJavaScript({cwd});
    assert.deepEqual(files,['.github/scripts/helper.cjs','nested/newly-added.mjs','root.js']);
    assert(!files.includes('untracked.js'));
    assert(!files.includes('generated/asset.js'));
  });
});

test('newly tracked malformed source fails the same Node syntax parser CI uses',async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'pack1-syntax-invalid-'));
  try {
    git(cwd,['init','-q']);
    mkdirSync(join(cwd,'new'),{recursive:true});
    const file=join(cwd,'new','later.mjs');
    writeFileSync(file,'export const broken = ;\n');
    git(cwd,['add','new/later.mjs']);
    const results=await checkTrackedJavaScript(listTrackedJavaScript({cwd}),{cwd,concurrency:2});
    assert.equal(results.tested,1);
    assert.equal(results.failures.length,1);
    assert.equal(results.failures[0].file,'new/later.mjs');
    assert.match(results.failures[0].message,/SyntaxError|Unexpected token/);
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

test('tracked file absent from working tree fails closed',async()=>{
  await withRepository(async cwd=>{
    const names=listTrackedJavaScript({cwd});
    renameSync(join(cwd,'root.js'),join(cwd,'elsewhere.js'));
    const result=await checkTrackedJavaScript(names,{cwd,concurrency:2,check:async()=>({ok:true,message:''})});
    assert.deepEqual(result.failures,[{file:'root.js',message:'Tracked file is missing'}]);
  });
});

test('syntax checking never invokes a shell or network, and isolates individual failures',async()=>{
  await withRepository(async cwd=>{
    const seen=[];
    const result=await checkTrackedJavaScript(listTrackedJavaScript({cwd}),{
      cwd,concurrency:2,check:async file=>{
        seen.push(file);
        return {ok:!file.endsWith('root.js'),message:'synthetic parser failure'};
      },
    });
    assert.equal(result.tested,3);
    assert.deepEqual(seen.sort(),['.github/scripts/helper.cjs','nested/newly-added.mjs','root.js']);
    assert.deepEqual(result.failures,[{file:'root.js',message:'synthetic parser failure'}]);
    await assert.rejects(checkTrackedJavaScript([],{}),/Invalid syntax-check selection/);
  });
});
