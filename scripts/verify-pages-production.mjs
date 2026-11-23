// Read-only external smoke for GitHub Pages after deployment.
// Baseline checks public routes but *reports* old source exposure.
// Enforce mode rejects served source files and redirects. Some CDN errors are
// generic HTML 503 pages; those are reported separately from a clean 404.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const mode=process.argv[2]||'--enforce';
if(!['--baseline','--enforce'].includes(mode))throw Error('Use --baseline or --enforce');
const origin='https://packone.pro';
const live=[
  ['/', 'html'],
  ['/practice/', 'html'],
  ['/admin/', 'html'],
  ['/learn/', 'html'],
  ['/sets/fra/guide/', 'html'],
  ['/open/profile/', 'html'],
  ['/mobile-membership-complete/', 'html'],
  ['/.well-known/assetlinks.json', 'android'],
  ['/.well-known/apple-app-site-association', 'ios'],
  ['/ads.txt', 'ads'],
  ['/app-ads.txt', 'appads'],
  ['/robots.txt', 'txt'],
  ['/sitemap.xml', 'txt'],
  ['/data/catalog.json', 'json'],
  ['/corpus/draft-run/catalog.json', 'json']
];
const blocked=[
  '/package.json','/package-lock.json',
  '/worker/growth-function.js','/scripts/build-pages-preview.mjs',
  '/tests/pages-preview-allowlist.test.mjs',
  '/migrations/0016_retire_third_source.sql','/research/CONTEXTUAL-VALUE-V1-RUN.html',
  '/docs/SITE-PUBLISHING-PREVIEW.md','/edge/gateway.mjs'
];
// A 503 is not proof of a 404. Accept it only when the response contains a
// small, recognizable upstream HTML error page, not source bytes. Any 2xx,
// redirect, unknown status or unrecognized 503 still fails enforcement.
export function blockedSourceVerdict(status,contentType,body=''){
  if(status===404)return 'not-found';
  if(status===503 && /^text\/html(?:\s*;|\s*$)/i.test(contentType||'') &&
    typeof body==='string' && body.length>0 && body.length<=65536 &&
    /<(?:!doctype\s+html|html)(?:\s|>)/i.test(body) &&
    /\b(?:503|service unavailable|backend unavailable|temporarily unavailable|error)\b/i.test(body))
    return 'upstream-error';
  return 'unverified';
}
async function collect(){
  const results=[],failures=[],warnings=[];
  for(const [path,kind] of live){
    try{
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
      // Before publication, the candidate's new route legitimately returns 404.
      // Post-deployment enforcement must still require the actual file.
      if(mode==='--baseline'&&path==='/app-ads.txt'&&response.status===404){
        results.push([path,response.status,response.headers.get('content-type')]);continue;
      }
      if(response.status!==200){
        failures.push(path+' expected HTTP 200, got '+response.status);
        results.push([path,response.status,response.headers.get('content-type')]);continue;
      }
      const data=await response.text();
      let ok=true;
      if(kind==='html')ok=data.includes('<html') && data.includes('Pack One');
      if(kind==='android'){
        const associations=JSON.parse(data);
        ok=Array.isArray(associations)&&associations.some(x=>x.target?.package_name==='pro.packone.app');
      }
      if(kind==='ios'){
        const association=JSON.parse(data);
        ok=Array.isArray(association.applinks?.details)&&association.applinks.details.length>0;
      }
      if(kind==='ads')ok=data.includes('google.com, pub-1217971050094766');
      if(kind==='appads')ok=data.trim()==='google.com, pub-1217971050094766, DIRECT, f08c47fec0942fa0';
      if(kind==='json')JSON.parse(data);
      if(!ok)failures.push(path+' returned unexpected '+kind+' content');
      results.push([path,response.status,response.headers.get('content-type')]);
    }catch(e){failures.push(path+' GET error: '+e.message);}
  }
  for(const path of blocked){
    try{
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
      results.push([path,response.status,response.headers.get('content-type')]);
      let body='';
      if(mode==='--enforce' && response.status===503 && /^text\/html(?:\s*;|\s*$)/i.test(response.headers.get('content-type')||''))
        body=await response.text();
      else await response.body?.cancel();
      if(mode==='--enforce'){
        const verdict=blockedSourceVerdict(response.status,response.headers.get('content-type'),body);
        if(verdict==='unverified')failures.push(path+' must be absent, got HTTP '+response.status+' ('+(response.headers.get('content-type')||'unknown type')+')');
        if(verdict==='upstream-error')warnings.push(path+' returned an upstream HTML 503 error, not source content (404 not confirmed).');
      }
    }catch(e){if(mode==='--enforce')failures.push(path+' GET error: '+e.message);}
  }
  return {results,failures,warnings};
}
const attempts=mode==='--enforce'?6:1;
async function main(){
  for(let attempt=1;attempt<=attempts;attempt++){
    const {results,failures,warnings}=await collect();
    console.log('Public Pages HTTP '+mode+' attempt '+attempt+'/'+attempts+':');
    for(const [path,status,type] of results)console.log(' '+status+' '+path+' ('+(type||'no type')+')');
    if(warnings.length)console.warn('CDN errors (not confirmed 404):\n'+warnings.join('\n'));
    if(!failures.length){
      console.log('PASS: site routes, legal/ads/mobile files'+(mode==='--enforce'?' and inaccessible source paths':'')+' validated.');
      break;
    }
    console.error(failures.join('\n'));
    if(attempt===attempts)process.exitCode=1;
    else await new Promise(resolve=>setTimeout(resolve,15000));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
