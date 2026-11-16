// Preview-only allowlist of public Pack One site files.
// This does NOT change the live GitHub Pages/Jekyll source or deployment.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {dirname,resolve,sep,posix} from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT_FILES=new Set(["CNAME","achievement-icons.mjs","ad-config.js","admin-api-contract.mjs","ads.mjs","ads.txt","bootstrap.mjs","campaign-links.json","campaign-links.mjs","card-faces.mjs","card-image-policy.mjs","card-metadata.mjs","card-viewer.css","card-viewer.mjs","client-errors.mjs","corpus-components.mjs","corpus-quality.mjs","creator-challenge-pages.mjs","creator-challenges.json","cube-home.mjs","daily-home.css","daily-home.mjs","daily-reminder-settings.mjs","daily-selection.mjs","decision-clock.mjs","draft-run-difficulty.mjs","draft-run-feedback.mjs","draft-run-format.mjs","draft-run-policy.mjs","draft-run-product.mjs","draft-run-reveal.mjs","draft-run.css","draft-run.mjs","editorial.css","engagement.mjs","favicon.ico","fonts.css","game-date.mjs","gameplay.mjs","growth-api.mjs","growth.mjs","historical-share.mjs","home-today.css","home-today.mjs","html.mjs","index.html","launch-alert-policy.mjs","launch-monitoring.mjs","leaderboard-config.js","membership-source.mjs","model-versions.json","my-pack-insights.mjs","my-pack-one.mjs","pack-one-icon-v1.png","pack1.css","patreon-activation.mjs","patreon-page.mjs","patreon-policy.mjs","practice-page.mjs","practice.css","profile-core.mjs","profile-polish.mjs","profile-product.mjs","profile.css","progression.mjs","puzzle-selection.mjs","render-lifecycle.mjs","replay-data.mjs","retention-events.mjs","retention.mjs","results-copy.json","results-settings.mjs","robots.txt","scoring.mjs","serving-quality.mjs","set-guides.css","set-guides.mjs","share-cards.mjs","share-daily-v1.png","shared-run-links.mjs","site-nav.mjs","sitemap.xml","social-card-v1.png","social-preview-v2.png","social-preview-v3.jpg","social-preview-v4.jpg","social-preview-v5.png","social-preview-v6.png","social-preview.png","tcgplayer-config.js","tcgplayer.mjs","today-status.mjs","trophy-deck-dialog.mjs","visual-c.css"]);
const ROUTE_DIRS=new Set([
  'about','contact','privacy','terms','how-it-works','practice','patreon',
  'scoring','methodology','disclosure','learn','admin','creator','go',
  'share','d','open','reset-password','mobile-membership-complete','sets'
]);
const WEB_FILE=/\.(?:html|js|mjs|css|json|png|jpe?g|svg|webp|ico)$/i;
const DATA_ROOT=new Set(['data/catalog.json','data/selection-policy.json','data/set-display-names.json','data/status.json']);
const ASSETS_ROOT=new Set(['assets/pack-one-share-banner-v1.svg','assets/tcgplayer-logo-primary-stroke.webp']);
export const REQUIRED_SITE_PATHS=Object.freeze([
  'index.html','CNAME','ads.txt','robots.txt','sitemap.xml',
  '.well-known/apple-app-site-association','.well-known/assetlinks.json',
  'social-preview-v6.png','assets/fonts/source-sans-3-400.woff2',
  'about/index.html','contact/index.html','privacy/index.html','terms/index.html',
  'practice/index.html','admin/index.html','learn/index.html','sets/index.html',
  'reset-password/index.html','mobile-membership-complete/index.html',
  'open/daily/index.html','open/profile/index.html','open/shared/index.html',
  'share/daily/index.html','d/index.html','go/reddit/index.html',
  'creator/lordsoflimited/index.html','data/catalog.json','data/selection-policy.json',
  'corpus/draft-run/catalog.json'
]);

function validPath(path){
  return typeof path==='string' && path.length>0 && !path.startsWith('/') &&
    !path.includes('\\') && !/[\0\r\n]/.test(path) &&
    !path.split('/').some(part=>!part||part==='.'||part==='..');
}
export function isPublicSitePath(path){
  if(!validPath(path))return false;
  if(!path.includes('/'))return ROOT_FILES.has(path);
  const root=path.split('/')[0];
  if(ROUTE_DIRS.has(root))return WEB_FILE.test(path);
  if(root==='.well-known')return path==='.well-known/apple-app-site-association'||path==='.well-known/assetlinks.json';
  if(root==='assets')return ASSETS_ROOT.has(path)||/^assets\/fonts\/[A-Za-z0-9-]+\.(?:woff2|txt)$/.test(path);
  if(root==='data')return DATA_ROOT.has(path)||/^data\/[a-z0-9-]+\/(?:manifest|path-model|quality)\.json$/.test(path);
  if(root==='corpus')return /^(?:corpus\/(?:card-face-metadata|card-metadata-repairs)\.json|corpus\/card-strength\/[a-z0-9-]+\.json|corpus\/draft-run\/(?:[a-z0-9-]+\.json\.gz|(?:card-images|card-printings|catalog)\.json|evidence\/[a-z0-9-]+\.json\.gz)|corpus\/trophy-decks\/[a-z0-9-]+\.(?:mjs|json))$/.test(path);
  return false;
}
export function planPublicSite(paths){
  if(!Array.isArray(paths)||!paths.length)throw Error('Empty tracked-site inventory');
  const seen=new Set(),included=[],excluded=[];
  for(const path of paths){
    if(!validPath(path)||seen.has(path))throw Error('Invalid/duplicate tracked path: '+JSON.stringify(path));
    seen.add(path);
    (isPublicSitePath(path)?included:excluded).push(path);
  }
  for(const required of REQUIRED_SITE_PATHS){
    if(!seen.has(required)||!isPublicSitePath(required))throw Error('Required public site file missing: '+required);
  }
  included.sort(); excluded.sort();
  return {included,excluded};
}
export function trackedSitePaths({cwd=process.cwd()}={}){
  const result=spawnSync('git',['ls-files','--cached','-z'],{
    cwd,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']
  });
  if(result.error||result.status!==0||result.signal||!result.stdout?.endsWith('\0')){
    throw Error('Cannot obtain complete tracked Git index for site preview');
  }
  return result.stdout.slice(0,-1).split('\0');
}
function localResource(raw,source){
  if(!raw||raw.startsWith('#')||raw.startsWith('?')||/^(?:data:|blob:|mailto:|javascript:)/i.test(raw))return null;
  let resolved;
  try{resolved=new URL(raw,'https://packone.pro/'+source);}catch{return null;}
  if(resolved.origin!=='https://packone.pro')return null;
  let path;
  try{path=decodeURIComponent(resolved.pathname).replace(/^\/+/,'');}catch{throw Error('Bad URL encoding in '+source);}
  if(!path||path.endsWith('/'))path+='index.html';
  if(!validPath(path))throw Error('Unsafe resource URL in '+source+': '+raw);
  return path;
}
// Checks concrete HTML resource references and CSS url() paths. Dynamic JS
// imports/fetches, authenticated flows and network providers require browser QA.
export async function verifyStaticReferences(included,{cwd=process.cwd()}={}){
  const files=new Set(included),broken=[];
  for(const source of included){
    const html=source.endsWith('.html'),css=source.endsWith('.css');
    if(!html&&!css)continue;
    const content=await readFile(resolve(cwd,source),'utf8');
    const matches=html
      ? content.matchAll(/<(?:script|link|img|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)
      : content.matchAll(/url\(\s*["']?([^)"'\s]+)["']?\s*\)/gi);
    for(const match of matches){
      const target=localResource(match[1],source);
      if(target&&!files.has(target))broken.push(source+' -> '+target);
    }
  }
  if(broken.length)throw Error('Missing preview static resources:\n'+broken.slice(0,30).join('\n'));
}
// Follow the literal import graph of modules actually reachable from HTML.
// Does not parse computed dynamic imports or perform network/auth browser tests.
export async function verifyBrowserModuleReferences(included,{cwd=process.cwd()}={}){
  const files=new Set(included),pending=[],visited=new Set(),missing=[];
  function references(content,source){
    const patterns=[
      /\b(?:import|export)\s+(?:[^"';]*?\bfrom\s+)?["']([^"']+)["']/g,
      /\bimport\s*\(\s*["']([^"']+)["']/g,
      /\bnew\s+URL\s*\(\s*["']([^"']+)["']/g
    ];
    for(const pattern of patterns)for(const match of content.matchAll(pattern)){
      const target=localResource(match[1],source);
      if(!target)continue;
      if(!files.has(target))missing.push(source+' -> '+target);
      else if(/\.(?:mjs|js)$/.test(target))pending.push(target);
    }
  }
  for(const source of included){
    if(!source.endsWith('.html'))continue;
    const html=await readFile(resolve(cwd,source),'utf8');
    for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
      const attrs=match[1],src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      if(src){
        const target=localResource(src[1],source);
        if(target&&!files.has(target))missing.push(source+' -> '+target);
        else if(target&&/\.(?:mjs|js)$/.test(target))pending.push(target);
      }else if(/\btype\s*=\s*["']module["']/i.test(attrs)){
        references(match[2],source);
      }
    }
  }
  while(pending.length){
    const source=pending.pop();
    if(visited.has(source))continue;
    visited.add(source);
    references(await readFile(resolve(cwd,source),'utf8'),source);
  }
  if(missing.length)throw Error('Missing browser module dependencies:\n'+missing.slice(0,30).join('\n'));
  return {checked:visited.size};
}
// Fail closed: never merge files into a stale output directory and never write
// outside the repository's ignored artifacts/ directory.
export async function buildPublicSitePreview({cwd=process.cwd(),outDir='artifacts/pages-preview'}={}){
  const root=resolve(cwd),dest=resolve(root,outDir),artifactRoot=resolve(root,'artifacts');
  if(!dest.startsWith(artifactRoot+sep))throw Error('Preview destination must be beneath artifacts/');
  const plan=planPublicSite(trackedSitePaths({cwd:root}));
  await verifyStaticReferences(plan.included,{cwd:root});
  await verifyBrowserModuleReferences(plan.included,{cwd:root});
  await mkdir(dirname(dest),{recursive:true});
  await mkdir(dest); // EEXIST deliberately fails: a stale file must not survive.
  const manifest=[];
  for(const path of plan.included){
    const source=resolve(root,path),target=resolve(dest,path);
    const metadata=await lstat(source);
    if(!metadata.isFile()||metadata.isSymbolicLink())throw Error('Unsafe or missing tracked public file: '+path);
    const bytes=await readFile(source);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,bytes,{flag:'wx'});
    manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return {included:manifest.length,excluded:plan.excluded.length,
    totalBytes:manifest.reduce((sum,x)=>sum+x.bytes,0),manifest};
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length===0||(args.length===1&&args[0]==='--check')){
    const plan=planPublicSite(trackedSitePaths());
    await verifyStaticReferences(plan.included);
    await verifyBrowserModuleReferences(plan.included);
    console.log('Safe site preview: '+plan.included.length+' included, '+plan.excluded.length+' excluded; checked HTML/CSS assets (no publication).');
    return;
  }
  if(args.length===2&&args[0]==='--out'){
    const result=await buildPublicSitePreview({outDir:args[1]});
    console.log('Preview-only site: '+result.included+' files / '+result.totalBytes+' bytes; '+result.excluded+' excluded.');
    return;
  }
  throw Error('Usage: node scripts/build-pages-preview.mjs [--check | --out artifacts/SUBDIR]');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
