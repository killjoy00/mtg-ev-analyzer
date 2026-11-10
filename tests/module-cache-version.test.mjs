import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';

// The site currently serves the repository root. Exclude non-browser tooling,
// not an allowlist of known modules: a newly added page or module is checked.
const NOT_SHIPPED=new Set([
  '.git','.github','node_modules','tests','scripts','worker','edge',
  'mobile','docs','research','results','corpus','data','migrations',
  'artifacts','.venv','venv',
]);
const ORIGIN='https://packone.pro';

function* shippedSources(folder='.',root=true) {
  for(const item of readdirSync(folder,{withFileTypes:true})) {
    if(root&&NOT_SHIPPED.has(item.name))continue;
    if(item.name.startsWith('.')&&item.isDirectory())continue;
    const pathname=join(folder,item.name);
    if(item.isDirectory())yield* shippedSources(pathname,false);
    else if(item.isFile()&&/\.(?:html|mjs|js)$/.test(item.name))yield pathname;
  }
}

function importedSpecifiers(source,isHtml) {
  const found=[];
  // Static imports, dynamic imports with a literal argument, and re-exports.
  for(const re of [
    /\bfrom\s*['"]([^'"]+\.[mc]?js(?:\?[^'"]*)?)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+\.[mc]?js(?:\?[^'"]*)?)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+\.[mc]?js(?:\?[^'"]*)?)['"]/g,
  ])for(const match of source.matchAll(re))found.push(match[1]);
  if(isHtml) {
    for(const match of source.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const tag=match[0];
      const moduleScript=/^<script\b/i.test(tag)&&/\btype\s*=\s*['"]module['"]/i.test(tag);
      const preload=/^<link\b/i.test(tag)&&/\brel\s*=\s*['"]modulepreload['"]/i.test(tag);
      if(!moduleScript&&!preload)continue;
      const url=tag.match(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/i)?.[1];
      if(url)found.push(url);
    }
  }
  return found;
}

function canonicalModuleUrl(specifier,sourceFile) {
  const url=new URL(specifier,new URL('/'+sourceFile,ORIGIN));
  if(url.origin!==ORIGIN||!/\.[mc]?js$/i.test(url.pathname))return null;
  return url.pathname+url.search;
}

function duplicateModuleUrls(sources) {
  const urls=new Map();
  for(const [pathname,source] of sources) {
    for(const specifier of importedSpecifiers(source,pathname.endsWith('.html'))) {
      const url=canonicalModuleUrl(specifier,pathname);
      if(!url)continue;
      const modulePath=url.split('?')[0];
      // References to external routes do not become browser module identities;
      // all local source imports must resolve to real files in the checkout.
      if(!existsSync('.'+modulePath))continue;
      if(!urls.has(modulePath))urls.set(modulePath,new Map());
      const byUrl=urls.get(modulePath);
      if(!byUrl.has(url))byUrl.set(url,[]);
      byUrl.get(url).push(pathname);
    }
  }
  return {urls,duplicates:[...urls.entries()]
    .filter(([,versions])=>versions.size>1)
    .map(([path,versions])=>path+': '+[...versions.entries()]
      .map(([url,parents])=>url+' via '+parents.slice(0,4).join(', ')).join(' | '))};
}

test('all locally shipped ES module files have one browser URL across every page',()=>{
  const sources=[...shippedSources()].map(file=>[
    relative('.',resolve(file)).split(sep).join('/'),readFileSync(file,'utf8'),
  ]);
  const {urls,duplicates}=duplicateModuleUrls(sources);
  assert.ok(sources.length>=100,'The source inventory must not silently shrink to a small allowlist');
  assert.ok(urls.size>=40,'The test must cover the browser module graph, not just known failures');
  assert.deepEqual(duplicates,[],'ES module URL variants instantiate independent stateful modules');
});

test('new module versions are detected without changing an allowlist',()=>{
  const sources=[
    ['first.mjs',"import './new-module.mjs?v=1';"],
    ['second.mjs',"await import('/new-module.mjs?v=2');"],
  ];
  const specifiers=sources.flatMap(([file,source])=>importedSpecifiers(source,false)
    .map(spec=>canonicalModuleUrl(spec,file)));
  assert.deepEqual(specifiers,['/new-module.mjs?v=1','/new-module.mjs?v=2']);
  assert.equal(new Set(specifiers).size,2);
});

test('main entrypoint and practice preloads keep matching release cache versions',()=>{
  const index=readFileSync('index.html','utf8');
  const practice=readFileSync('practice/index.html','utf8');
  const main=index.match(/bootstrap\.mjs(\?v=\d+)/)?.[1];
  const preload=practice.match(/bootstrap\.mjs(\?v=\d+)/)?.[1];
  assert.ok(main,'main bootstrap must be release-versioned');
  assert.equal(preload,main,'preloading a different URL fetches a second module');
});
