// Read-only Apple universal-link diagnosis. No authentication, app install,
// releases, DNS, server headers or production API writes.
// --check validates repository associations offline; --live also compares the
// published origin and Apple's cached copy without assuming CDN == device approval.
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export const DOMAIN='packone.pro';
const PATHS=['/open/profile/','/open/shared/','/open/daily/','/creator/'];
const AASA_URL='https://'+DOMAIN+'/.well-known/apple-app-site-association';
const APPLE_CDN_URL='https://app-site-association.cdn-apple.com/a/v1/'+DOMAIN;
export function inspectAssociation(association,config){
  const errors=[];
  const bundle=config?.expo?.ios?.bundleIdentifier;
  const associatedDomains=config?.expo?.ios?.associatedDomains||[];
  if(typeof bundle!=='string'||!bundle)errors.push('iOS production bundle identifier missing');
  if(!associatedDomains.includes('applinks:'+DOMAIN))errors.push('Expected associated domain missing');
  const details=association?.applinks?.details;
  if(!Array.isArray(details)||!details.length)errors.push('No applinks.details found');
  const entries=Array.isArray(details)?details:[];
  const matching=entries.filter(x=>Array.isArray(x.appIDs)&&x.appIDs.some(id=>
    typeof id==='string'&&id.endsWith('.'+bundle)&&
    /^[A-Z0-9]{10}\./.test(id)));
  if(!matching.length)errors.push('No Apple Team ID + app bundle match');
  for(const path of PATHS){
    if(!matching.some(entry=>Array.isArray(entry.components)&&
      entry.components.some(rule=>rule?.['/']===path+'*'&&!rule.exclude))){
      errors.push('Missing required universal link prefix: '+path);
    }
  }
  const intent=config?.expo?.android?.intentFilters||[];
  for(const path of PATHS){
    if(!intent.some(item=>item.action==='VIEW' && item.autoVerify===true &&
      (item.data||[]).some(d=>d.host===DOMAIN&&d.scheme==='https'&&d.pathPrefix===path))){
      errors.push('Android intent does not match iOS link path: '+path);
    }
  }
  return {bundle,matchedAppIDs:matching.flatMap(x=>x.appIDs).filter(x=>x.endsWith('.'+bundle)),paths:PATHS,errors};
}
async function getPublic(url){
  try{
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{'accept':'application/json,text/plain,*/*'}});
    const body=(await response.text()).slice(0,131072);
    let json=null;
    if(response.status===200){try{json=JSON.parse(body);}catch{}}
    return {status:response.status,contentType:response.headers.get('content-type'),
      redirectTo:response.headers.get('location')||null,json,
      bodySample:json?null:body.slice(0,180)};
  }catch(e){return {status:null,contentType:null,json:null,error:String(e?.message||e)};}
}
export async function diagnose({live=false}={}){
  const [aasaText,configText]=await Promise.all([
    readFile(resolve('.well-known/apple-app-site-association'),'utf8'),
    readFile(resolve('mobile/app.json'),'utf8')
  ]);
  const stored=JSON.parse(aasaText),config=JSON.parse(configText),local=inspectAssociation(stored,config);
  const result={domain:DOMAIN,checkedAt:new Date().toISOString(),local,
    expectedAppIDs:local.matchedAppIDs,expectedRoutes:PATHS,
    trackedSha256:createHash('sha256').update(aasaText).digest('hex'),remote:null,
    warnings:[],errors:[...local.errors]};
  if(!live)return result;
  const [origin,apple]=await Promise.all([getPublic(AASA_URL),getPublic(APPLE_CDN_URL)]);
  result.remote={origin:{status:origin.status,contentType:origin.contentType,redirectTo:origin.redirectTo||null},
    appleCDN:{status:apple.status,contentType:apple.contentType,redirectTo:apple.redirectTo||null}};
  for(const [name,response] of [['origin',origin],['Apple CDN',apple]]){
    if(response.status!==200||!response.json){
      result.warnings.push(name+' did not return HTTP 200 with JSON: '+
        (response.status??'network error')+(response.error?' ('+response.error+')':'')+
        (response.bodySample?' ('+response.bodySample+')':''));
      continue;
    }
    const inspected=inspectAssociation(response.json,config);
    // Apple's CDN and the origin must both list the expected app/routing rules;
    // these checks do NOT establish on-device Site/Fmwk approval.
    if(inspected.errors.length)result.warnings.push(name+' association mismatch: '+inspected.errors.join('; '));
    if(name==='origin'&&JSON.stringify(response.json)!==JSON.stringify(stored)){
      result.warnings.push('Published origin JSON differs from the checked-in AASA');
    }
    if(!/^application\/json\b/i.test(response.contentType||'')){
      result.warnings.push(name+' AASA Content-Type is '+(response.contentType||'(none)'));
    }
  }
  return result;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--check','--live'].includes(args[0])){
    throw Error('Usage: node scripts/check-apple-associated-domains.mjs --check|--live');
  }
  const report=await diagnose({live:args[0]==='--live'});
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/apple-associated-domains.json',JSON.stringify(report,null,2)+'\n');
  console.log('Apple associated domains report:\n'+JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    await appendFile(process.env.GITHUB_STEP_SUMMARY,[
      '## Pack One associated-domains diagnosis',
      '- Tracked association errors: '+report.errors.length,
      '- Origin HTTP: '+(report.remote?.origin.status??'not requested'),
      '- Apple CDN HTTP: '+(report.remote?.appleCDN.status??'not requested'),
      '- Warnings: '+report.warnings.length,
      '- **On-device approval cannot be inferred from an HTTP response.**',
      ''
    ].join('\n'));
  }
  // Local app/site configuration mismatches are actionable regressions.
  if(report.errors.length)process.exitCode=1;
  // Remote/CDN and MIME problems are surfaced as annotations without blocking
  // releases because Apple CDN caching and availability are independent.
  for(const warning of report.warnings)console.log('::warning::'+warning.replace(/[\r\n]/g,' '));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{console.error(e);process.exitCode=1;});
}
