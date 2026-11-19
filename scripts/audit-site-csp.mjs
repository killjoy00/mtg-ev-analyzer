// Read-only CSP preparation audit for the tracked, published Pack One surface.
// Heuristic source inventory: NOT a policy, a scanner for exploitable sinks or
// proof that a source/origin is reached at runtime. No live traffic.
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {planPublicSite,trackedSitePaths} from './build-pages-preview.mjs';

const BASE='https://packone.pro';
const urlPattern=/https?:\/\/[a-z0-9][a-z0-9._:-]*/gi;
export function originsIn(source){
  const values=new Set();
  for(const raw of source.match(urlPattern)||[]){
    try{
      const url=new URL(raw);
      if(url.origin!==BASE)values.add(url.origin);
    }catch{}
  }
  return [...values].sort();
}
const hashScript=content=>"'sha256-"+createHash('sha256').update(content).digest('base64')+"'";
export function scanHtml(path,source){
  const inlineScripts=[],externalScripts=[],inlineStyles=[],metaPolicies=[],eventHandlers=[],originHints=originsIn(source);
  for(const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    const attrs=m[1]||'';
    const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if(src){externalScripts.push(src[1]);continue;}
    if(m[2].trim())inlineScripts.push({sha256:hashScript(m[2]),bytes:Buffer.byteLength(m[2]),module:/\btype\s*=\s*["']module["']/i.test(attrs)});
  }
  for(const m of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)){
    if(m[1].trim())inlineStyles.push({sha256:hashScript(m[1]),bytes:Buffer.byteLength(m[1])});
  }
  for(const m of source.matchAll(/<meta\b[^>]*\bhttp-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi)){
    metaPolicies.push(m[0].slice(0,400));
  }
  for(const m of source.matchAll(/<[\w-]+\b[^>]*\s(on[a-z]+)\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi)){
    eventHandlers.push(m[1].toLowerCase());
  }
  for(const m of source.matchAll(/<[\w-]+\b[^>]*\sstyle\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi)){
    inlineStyles.push({attribute:true,tag:m[0].slice(1,32)});
  }
  return {path,kind:'html',inlineScripts,externalScripts,inlineStyles,metaPolicies,eventHandlers,originHints};
}
export function scanJs(path,source){
  const indicators=[
    ['script-creation',/\bcreateElement\s*\(\s*['"]script['"]\s*\)/g],
    ['script-src-assignment',/\b(?:script|element|tag|node)\.src\s*=/g],
    ['html-sink',/\b(?:innerHTML|outerHTML)\s*=/g],
    ['adjacent-html',/\binsertAdjacentHTML\s*\(/g],
    ['document-write',/\bdocument\.write(?:ln)?\s*\(/g],
    ['dynamic-import',/\bimport\s*\(/g],
    ['eval',/\beval\s*\(/g],
    ['function-constructor',/\bnew\s+Function\s*\(/g],
    ['open-window',/\bwindow\.open\s*\(/g],
    ['new-worker',/\bnew\s+(?:Worker|SharedWorker)\s*\(/g]
  ];
  const sinks=[];
  for(const [kind,re] of indicators){
    for(const m of source.matchAll(re)){
      const line=source.slice(0,m.index).split('\n').length;
      sinks.push({kind,line});
    }
  }
  sinks.sort((a,b)=>a.line-b.line||a.kind.localeCompare(b.kind));
  return {path,kind:'javascript',sinks,originHints:originsIn(source)};
}
export async function inspectSite(){
  const {included}=planPublicSite(trackedSitePaths());
  const files=[];let pages=0,scripts=0,styles=0,handlers=0,jsFiles=0,jsSinks=0;
  const origins=new Map();
  for(const path of included){
    if(!/\.(?:html|js|mjs|css)$/.test(path))continue;
    const source=await readFile(resolve(path),'utf8');
    const item=path.endsWith('.html')?scanHtml(path,source):/\.(?:js|mjs)$/.test(path)?scanJs(path,source):{path,kind:'css',originHints:originsIn(source)};
    if(item.kind==='html'){pages++;scripts+=item.inlineScripts.length;styles+=item.inlineStyles.length;handlers+=item.eventHandlers.length;}
    if(item.kind==='javascript'){jsFiles++;jsSinks+=item.sinks.length;}
    for(const origin of item.originHints){
      const set=origins.get(origin)||new Set();set.add(path);origins.set(origin,set);
    }
    if(item.kind==='html'||item.sinks?.length||item.originHints?.length)files.push(item);
  }
  const originHints=[...origins].map(([origin,paths])=>({origin,files:[...paths].sort()})).sort((a,b)=>a.origin.localeCompare(b.origin));
  return {
    generatedAt:new Date().toISOString(),
    notice:'Offline source inventory only. URL literals, sinks and inline hashes do not prove runtime reachability or exploitability.',
    summary:{trackedPublicFiles:included.length,pages,jsFiles,inlineScriptBlocks:scripts,
      inlineStyleBlocksOrAttributes:styles,inlineEventAttributes:handlers,jsSinkOccurrences:jsSinks,
      externalOriginHints:originHints.length},
    originHints,files
  };
}
async function main(){
  if(process.argv.length!==2)throw Error('Usage: node scripts/audit-site-csp.mjs');
  const report=await inspectSite();
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/site-csp-audit.json',JSON.stringify(report,null,2)+'\n');
  const sum=report.summary;
  console.log('Site CSP inventory: '+JSON.stringify(sum));
  console.log('Origin hints (requires manual runtime classification): '+
    report.originHints.map(x=>x.origin+' ['+x.files.length+' files]').join(', '));
  const inline=report.files.filter(x=>x.inlineScripts?.length);
  console.log('HTML pages with inline scripts: '+inline.map(x=>x.path+'='+x.inlineScripts.length).join(', '));
  if(process.env.GITHUB_STEP_SUMMARY){
    const lines=[
      '## Source-only CSP inventory (not enforced)',
      '| Metric | Count |',
      '|---|---:|',
      ...Object.entries(sum).map(([k,v])=>'| '+k+' | '+v+' |'),
      '',
      'Inline-script files: '+inline.map(x=>x.path).join(', '),
      '',
      '**Do not deploy script-src self-only or a fake meta Report-Only policy from this report.**',
      'Classify ad/auth/API origins and computed runtime scripts before an isolated HTTP-header Report-Only experiment.',
      ''
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n'));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{console.error(e);process.exitCode=1;});
}
