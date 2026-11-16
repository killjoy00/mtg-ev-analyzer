import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {
  REQUIRED_SITE_PATHS,isPublicSitePath,planPublicSite,
  trackedSitePaths,verifyStaticReferences,verifyBrowserModuleReferences,buildPublicSitePreview
} from '../scripts/build-pages-preview.mjs';

const forbidden=[
  'worker/growth-function.js','scripts/build-pages-preview.mjs','tests/pages-preview-allowlist.test.mjs',
  'migrations/0016_retire_third_source.sql','research/example.json',
  'docs/SECURITY.md','results/production-verification.json',
  'mobile/src/App.tsx','edge/gateway.mjs','.github/workflows/test.yml',
  'package.json','package-lock.json','ads.txt.example','README.md','AGENTS.md',
  'data/import-queue.json','data/powered-cube/shards/raw.json',
  'corpus/trophy-decks/README.md','assets/brand/README.md',
  'a/../data/catalog.json','/etc/passwd','foo\\bar','secret.js'
];
test('site allowlist refuses non-site source and future unreviewed root files',()=>{
  for(const file of forbidden)assert.equal(isPublicSitePath(file),false,file);
});
test('public routes, auth associations, ads and versioned game assets remain eligible',()=>{
  for(const file of REQUIRED_SITE_PATHS)assert.equal(isPublicSitePath(file),true,file);
  for(const file of [
    'assets/fonts/barlowcondensed-OFL.txt','assets/fonts/sourcesans3-OFL.txt',
    'sets/fra/guide/index.html','sets/guides/data/fra.json',
    'creator/realityfracture/creator-card.png','creator/canary-daily-69af6b03/index.html',
    'go/tcg/index.html','share/daily/latest/index.html','d/c/index.html',
    'admin/puzzle-review/puzzle-review-v3-set.json',
    'data/fra/path-model.json','data/fra/quality.json',
    'corpus/draft-run/fra.json.gz','corpus/draft-run/evidence/fra.json.gz',
    'corpus/trophy-decks/fra.mjs','corpus/card-strength/fra.json',
    'assets/fonts/source-sans-3-600.woff2'
  ]) assert.equal(isPublicSitePath(file),true,file);
});
test('missing site contract or duplicate/traversal input fails closed',()=>{
  assert.throws(()=>planPublicSite(['index.html']),/Required public site file missing/);
  assert.throws(()=>planPublicSite(['index.html','index.html']),/duplicate/);
  assert.throws(()=>planPublicSite(['../test','index.html']),/Invalid/);
});
test('tracked main/PR site plan is reproducible and HTML/CSS static links resolve',async()=>{
  const tracked=trackedSitePaths();
  const plan=planPublicSite(tracked);
  assert.ok(plan.included.length>400,'unexpectedly small public preview');
  assert.ok(plan.excluded.length>1000,'unexpectedly broad public preview');
  assert.deepEqual(plan.included,[...plan.included].sort());
  assert.deepEqual(plan.excluded,[...plan.excluded].sort());
  assert.ok(plan.included.includes('index.html'));
  for(const f of forbidden)assert.equal(plan.included.includes(f),false,f);
  await verifyStaticReferences(plan.included);
  const modules=await verifyBrowserModuleReferences(plan.included);
  assert.ok(modules.checked>=50,'browser-reachable modules were not followed');
});
test('real-byte staging copies only approved files with verifiable checksums',async()=>{
  const artifacts=join(process.cwd(),'artifacts');
  await mkdir(artifacts,{recursive:true});
  const dir=await mkdtemp(join(artifacts,'pages-preview-test-'));
  const dest=join(dir,'site');
  try{
    const built=await buildPublicSitePreview({outDir:dest});
    assert.ok(built.included>400);
    assert.ok(built.excluded>1000);
    assert.ok(built.totalBytes>70_000_000);
    assert.equal(built.manifest.length,built.included);
    const index=await readFile(join(dest,'index.html'));
    assert.match(index.toString('utf8'),/Pack One/);
    for(const p of REQUIRED_SITE_PATHS)assert.ok((await stat(join(dest,p))).isFile(),p);
    for(const p of forbidden.filter(p=>!p.includes('..')&&!p.startsWith('/')&&!p.includes('\\'))){
      await assert.rejects(stat(join(dest,p)),{code:'ENOENT'},p);
    }
    const recorded=built.manifest.find(x=>x.path==='index.html');
    assert.equal(recorded.bytes,index.length);
    assert.equal(recorded.sha256,createHash('sha256').update(index).digest('hex'));
    await assert.rejects(buildPublicSitePreview({outDir:dest}),{code:'EEXIST'},
      'a second build must reject a stale output tree rather than leave excluded files behind');
  }finally{await rm(dir,{recursive:true,force:true});}
});
