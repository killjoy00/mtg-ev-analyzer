import {readFileSync} from 'node:fs';

const token=process.env.PLAY_ACCESS_TOKEN;
if(!token)throw Error('Missing Play service-account token');
const app='pro.packone.app',locale='en-US';
const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+app;
const expectedLegacy={id:'3455473393333885257',sha256:'ee1e899151c069698eab302a1936fd2237a3f0e1a692ee187fbf4687bbbc2428'};
const expectedIcon='e44233fe8cab56f5de4f891bc04450411122b4c592d68228dd37f486de361640';
const expectedFeature='c4c5f8437f8f195ddfde3755c2b7cd4ff52dd8f01e0479bba8f6324ffe73e969';
const approved=JSON.parse(readFileSync('.github/pack-one-approved-six-screenshots.json','utf8'));
const phoneHashes=Object.entries(approved.sha256).filter(([name])=>name.startsWith('google-play/')).sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v);
if(phoneHashes.length!==6)throw Error('Expected six pinned Google Play phone screenshots');

const req=async(path,{method='GET',body}={})=>{
  const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body,signal:AbortSignal.timeout(45000)});
  const t=await r.text();
  if(!r.ok)throw Error(method+' '+path+' HTTP '+r.status+': '+t.slice(0,900));
  return t?JSON.parse(t):{};
};
const images=async(edit,type)=>(await req('/edits/'+edit+'/listings/'+locale+'/'+type)).images||[];
const types=['phoneScreenshots','sevenInchScreenshots','tenInchScreenshots','icon','featureGraphic'];
const fingerprints=async edit=>{
  const result={};
  for(const type of types)result[type]=await images(edit,type);
  return result;
};
const fingerprint=arr=>JSON.stringify(arr.map(x=>[x.id,x.sha256]));
const assertProtected=(s)=>{
  if(s.phoneScreenshots.length!==6||s.phoneScreenshots.map(x=>x.sha256).join('|')!==phoneHashes.join('|'))throw Error('Six approved phone screenshots or ordering changed; abort.');
  if(s.icon.length!==1||s.icon[0].sha256!==expectedIcon)throw Error('Unrecognized app icon; abort.');
  if(s.featureGraphic.length!==1||s.featureGraphic[0].sha256!==expectedFeature)throw Error('Unrecognized feature graphic; abort.');
};
const assertLegacy=(s)=>{
  for(const type of ['sevenInchScreenshots','tenInchScreenshots']){
    if(s[type].length!==1||s[type][0].id!==expectedLegacy.id||s[type][0].sha256!==expectedLegacy.sha256)
      throw Error('Tablet image does not exactly match the confirmed obsolete asset: '+type+'; abort.');
  }
};
let edit=null,verifier=null,committed=false;
try{
  edit=(await req('/edits',{method:'POST',body:'{}'})).id;
  if(!edit)throw Error('Google Play did not create edit');
  const listing=await req('/edits/'+edit+'/listings/'+locale);
  if(listing.title!=='Pack One: Draft Challenge'||listing.language!==locale)throw Error('Play listing mismatch');
  const before=await fingerprints(edit);
  assertProtected(before);
  assertLegacy(before);
  for(const type of ['sevenInchScreenshots','tenInchScreenshots']){
    await req('/edits/'+edit+'/listings/'+locale+'/'+type,{method:'DELETE'});
    console.log('Removed the exact old '+type+' placement, asset id '+expectedLegacy.id);
  }
  const pending=await fingerprints(edit);
  assertProtected(pending);
  if(pending.sevenInchScreenshots.length!==0||pending.tenInchScreenshots.length!==0)throw Error('Tablet images still present in pending edit');
  for(const type of ['phoneScreenshots','icon','featureGraphic'])
    if(fingerprint(pending[type])!==fingerprint(before[type]))throw Error('Unapproved change to '+type);
  await req('/edits/'+edit+':commit',{method:'POST',body:'{}'});
  committed=true;
  edit=null;

  verifier=(await req('/edits',{method:'POST',body:'{}'})).id;
  if(!verifier)throw Error('Cannot verify committed edit');
  const after=await fingerprints(verifier);
  assertProtected(after);
  if(after.sevenInchScreenshots.length!==0||after.tenInchScreenshots.length!==0)throw Error('Tablet images remain after commit');
  for(const type of ['phoneScreenshots','icon','featureGraphic'])
    if(fingerprint(after[type])!==fingerprint(before[type]))throw Error('A protected image slot changed after commit: '+type);
  const listingAfter=await req('/edits/'+verifier+'/listings/'+locale);
  for(const key of ['title','shortDescription','fullDescription'])
    if(listingAfter[key]!==listing[key])throw Error('Listing copy changed: '+key);
  const receipt={uploaded:false,deleted:true,verified:true,packageName:app,locale,removed:{sevenInchScreenshots:1,tenInchScreenshots:1},phoneScreenshotsUnchanged:6,iconUnchanged:true,featureGraphicUnchanged:true,listingTextUnchanged:true,tracksUnchanged:true};
  console.log('PLAY_TABLET_CLEANUP_RECEIPT '+JSON.stringify(receipt));
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Pack One tablet screenshot cleanup\n\nRemoved the one obsolete image from each tablet category. Verified zero remaining 7-inch and 10-inch images, all six phone screenshots unchanged, icon and feature graphic unchanged, and original text unchanged. No app release or track changes.\n');
  }
}finally{
  if(edit&&!committed)await req('/edits/'+edit,{method:'DELETE'}).catch(e=>console.error('Could not discard uncommitted edit: '+e));
  if(verifier)await req('/edits/'+verifier,{method:'DELETE'}).catch(e=>console.error('Could not discard verifier edit: '+e));
}
