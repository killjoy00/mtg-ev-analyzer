// Compare the *actual* Jekyll output with the tracked public-site allowlist.
// Does not publish or change the production GitHub Pages source.
import {readdir,readFile,lstat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,sep,posix} from 'node:path';
import {createHash} from 'node:crypto';
import {planPublicSite,trackedSitePaths} from './build-pages-preview.mjs';

const jekyllDir=resolve(process.argv[2]||'_site');
const root=process.cwd();
const plan=planPublicSite(trackedSitePaths());
const allowed=new Set(plan.included);
const jekyllOnly=new Set(['assets/css/style.css']); // Optional Jekyll theme-generated CSS.
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const found=new Map();
async function visit(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const abs=resolve(dir,entry.name);
    const rel=relative(jekyllDir,abs).split(sep).join('/');
    if(entry.isSymbolicLink())throw Error('Jekyll output contains a symlink: '+rel);
    if(entry.isDirectory())await visit(abs);
    else if(entry.isFile())found.set(rel,abs);
    else throw Error('Unexpected Jekyll output type: '+rel);
  }
}
await visit(jekyllDir);
const missing=[],changed=[],extra=[],recognized=[];
let expectedBytes=0,siteBytes=0;
for(const file of plan.included){
  const original=await readFile(resolve(root,file));
  expectedBytes+=original.length;
  if(!found.has(file)){missing.push(file);continue;}
  const actual=await readFile(found.get(file));
  if(!original.equals(actual))changed.push({file,expected_sha256:hash(original),actual_sha256:hash(actual),expected_bytes:original.length,actual_bytes:actual.length});
}
for(const [file,abs] of found){
  const st=await lstat(abs);siteBytes+=st.size;
  if(!allowed.has(file)){
    if(jekyllOnly.has(file))recognized.push({file,bytes:st.size});
    else extra.push({file,bytes:st.size});
  }
}
const report={
  commit:process.env.GITHUB_SHA||null,
  expected_files:allowed.size,expected_bytes:expectedBytes,
  jekyll_files:found.size,jekyll_bytes:siteBytes,
  excluded_tracked_files:plan.excluded.length,
  missing,changed,unexpected:extra,jekyll_generated:recognized,
  passed:!missing.length&&!changed.length&&!extra.length
};
await mkdir(resolve(root,'artifacts'),{recursive:true});
await writeFile(resolve(root,'artifacts/pages-release-parity.json'),JSON.stringify(report,null,2)+'\n');
const detail=a=>a.slice(0,25).map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n');
console.log('Jekyll parity: '+report.jekyll_files+' actual files / '+report.jekyll_bytes+
  ' bytes; '+report.expected_files+' allowlisted / '+report.expected_bytes+' bytes; '+
  report.excluded_tracked_files+' excluded tracked paths.');
for(const [label,items] of [['missing',missing],['changed',changed],['unexpected',extra],['jekyll-generated',recognized]]){
  console.log(label+': '+items.length+(items.length?'\n'+detail(items):''));
}
if(process.env.GITHUB_STEP_SUMMARY){
  const summary=[
    '## GitHub Pages Jekyll allowlist parity',
    '| Metric | Count |',
    '| --- | ---: |',
    '| Allowlisted source files | '+allowed.size+' |',
    '| Actual Jekyll site files | '+found.size+' |',
    '| Excluded tracked files | '+plan.excluded.length+' |',
    '| Missing | '+missing.length+' |',
    '| Modified bytes | '+changed.length+' |',
    '| Unexpected published files | '+extra.length+' |',
    '| Recognized Jekyll-generated assets | '+recognized.length+' |',
    '| Total Jekyll site bytes | '+siteBytes+' |',
    '',
    report.passed?'**PASS: Jekyll output matches the reviewed public files.**':'**FAIL: Jekyll output differs from reviewed public files.**',
    ''
  ].join('\n');
  const {appendFile}=await import('node:fs/promises');
  await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
}
if(!report.passed)process.exitCode=1;
