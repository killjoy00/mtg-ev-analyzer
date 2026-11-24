// Assemble only reviewed source, brand assets and locked runtime dependencies.
// No config files, credentials, production data, replay corpus, or screenshots.
import {cp,copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=process.cwd(),output=resolve('dist/weekly-setup/runtime');
const tracked=new Set(execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean));
const norm=p=>p.replaceAll('\\','/');
const entry='scripts/pack-one-weekly-private-runner.mjs';
const assets=[
 'package.json','package-lock.json','pack1.css','draft-run.css','visual-c.css',
 'assets/fonts/barlow-condensed-600.woff2','assets/fonts/barlow-condensed-700.woff2',
 'assets/fonts/source-sans-3-400.woff2','assets/fonts/source-sans-3-600.woff2','assets/fonts/source-sans-3-700.woff2',
 'mobile/assets/images/brand-mark.svg','assets/store-badges/app-store-en-black.svg','assets/store-badges/google-play-en.png'
];
const visited=new Set(),todo=[entry,...assets];
// Imports are literal for this runtime. Copy their tracked dependency graph,
// rejecting anything outside the checkout or other than reviewed JS/JSON.
const specifier=/(?:\bimport\s*(?:[^'";]*?\s+from\s*|\s*)|\bexport\s+[^'";]*?\s+from\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g;
while(todo.length){
 const file=todo.pop();
 if(visited.has(file))continue;
 if(isAbsolute(file)||file.startsWith('../')||!tracked.has(file))throw Error('weekly-package-untracked-source');
 visited.add(file);
 if(/\.(?:mjs|js|cjs)$/.test(file)){
  const source=await readFile(resolve(root,file),'utf8');
  for(const [,spec] of source.matchAll(specifier)){
   // Browser-compatible ESM specifiers may include a cache-busting query
   // or fragment. Resolve the actual file exactly as Node's ESM loader does.
   const dependency=norm(relative(root,fileURLToPath(new URL(spec,pathToFileURL(resolve(root,file))))));
   if(!tracked.has(dependency))throw Error('weekly-package-untracked-dependency: '+file+' -> '+dependency);
   if(!/\.(?:mjs|js|cjs|json)$/.test(dependency))throw Error('weekly-package-unexpected-import: '+file+' -> '+dependency);
   todo.push(dependency);
  }
 }
 const dst=join(output,file);
 await mkdir(dirname(dst),{recursive:true});
 await copyFile(resolve(root,file),dst);
}
await copyFile(process.execPath,join(output,'node.exe'));
await cp(resolve('node_modules'),join(output,'node_modules'),{recursive:true});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(revision))throw Error('weekly-package-revision');
await writeFile(join(output,'build.json'),JSON.stringify({revision},null,2)+'\n');
// Prove transitive dependencies are present before packaging; import does
// not run the publishing CLI or connect to any service.
execFileSync(join(output,'node.exe'),['--input-type=module','-e',"await import('./scripts/pack-one-weekly-private-runner.mjs'); await import('pg'); await import('playwright'); const brand=await (await import('./scripts/pack-one-weekly-render.mjs')).loadWeeklyBrand(); if(!brand.ios||!brand.android)throw Error('missing brand');"],{cwd:output,stdio:'inherit'});
console.log('Private weekly runtime source and locked dependencies packaged.');
