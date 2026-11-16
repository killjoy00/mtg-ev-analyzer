// Read-only external smoke for GitHub Pages after deployment.
// Baseline checks public routes but *reports* old source exposure.
// Enforce mode requires unwanted source paths to return 404.
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
async function collect(){
  const results=[],failures=[];
  for(const [path,kind] of live){
    try{
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
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
      if(kind==='json')JSON.parse(data);
      if(!ok)failures.push(path+' returned unexpected '+kind+' content');
      results.push([path,response.status,response.headers.get('content-type')]);
    }catch(e){failures.push(path+' GET error: '+e.message);}
  }
  for(const path of blocked){
    try{
      const response=await fetch(origin+path,{signal:AbortSignal.timeout(20000),cache:'no-store'});
      results.push([path,response.status,response.headers.get('content-type')]);
      if(mode==='--enforce'&&response.status!==404){
        failures.push(path+' must return 404, got '+response.status);
      }
      await response.body?.cancel();
    }catch(e){if(mode==='--enforce')failures.push(path+' GET error: '+e.message);}
  }
  return {results,failures};
}
const attempts=mode==='--enforce'?6:1;
for(let attempt=1;attempt<=attempts;attempt++){
  const {results,failures}=await collect();
  console.log('Public Pages HTTP '+mode+' attempt '+attempt+'/'+attempts+':');
  for(const [path,status,type] of results)console.log(' '+status+' '+path+' ('+(type||'no type')+')');
  if(!failures.length){
    console.log('PASS: site routes, legal/ads/mobile files'+(mode==='--enforce'?' and blocked source paths':'')+' validated.');
    break;
  }
  console.error(failures.join('\n'));
  if(attempt===attempts)process.exitCode=1;
  else await new Promise(resolve=>setTimeout(resolve,15000));
}
