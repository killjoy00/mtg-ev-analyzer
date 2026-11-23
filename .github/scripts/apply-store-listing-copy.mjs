// Publish reviewed Google Play en-US copy and iOS 1.4 promotional text only.
// The next-version Apple description/keywords are deliberately not writable here.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const copy=JSON.parse(readFileSync(new URL('../pack-one-store-copy-en-US.json',import.meta.url),'utf8'));
const {googlePlay,apple,locale}=copy;
const packageName='pro.packone.app';
const appId='6814318676';
const liveIosVersion='1.4';
if(locale!=='en-US')throw Error('Only en-US is allowed');
if(googlePlay.title!=='Pack One: Draft Challenge'||apple.name!=='Pack One'||apple.subtitle!=='Daily Limited Draft Challenge')throw Error('Unexpected store identity');
if(googlePlay.title.length>30||googlePlay.shortDescription.length>80||googlePlay.fullDescription.length>4000||apple.promotionalText.length>170)throw Error('Store copy exceeds field limit');
if(!googlePlay.shortDescription.includes('Pack 1')||!apple.keywords.includes('pack1'))throw Error('Expected spelling variants missing');

const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();
const {ASC_KEY_ID:kid,ASC_ISSUER_ID:iss,ASC_PRIVATE_KEY:key}=process.env;
if(!playToken||!kid||!iss||!key)throw Error('Store credentials unavailable');

async function api(url,token,{method='GET',body}={}){
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const raw=await response.text();
  if(!response.ok)throw Error(method+' '+url.split('?')[0]+' HTTP '+response.status+': '+raw.slice(0,400));
  return raw?JSON.parse(raw):null;
}

const playRoot='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+packageName;
const play=(path,opts)=>api(playRoot+path,playToken,opts);
let editId='';
let committed=false;
try{
  const created=await play('/edits',{method:'POST',body:{}});
  editId=created.id;
  if(!editId)throw Error('Google Play edit ID missing');
  const path='/edits/'+encodeURIComponent(editId)+'/listings/'+locale;
  const previous=await play(path);
  if(previous.language&&previous.language!==locale)throw Error('Unexpected Play listing locale');
  if(previous.title!=='Pack One'&&previous.title!==googlePlay.title)throw Error('Play title changed since copy review');
  const changes={language:locale,title:googlePlay.title,shortDescription:googlePlay.shortDescription,fullDescription:googlePlay.fullDescription};
  // A PUT must not silently discard an existing Play video URL.
  if(typeof previous.video==='string'&&previous.video)changes.video=previous.video;
  const identical=Object.entries(changes).every(([name,value])=>previous[name]===value);
  if(!identical){
    await play(path,{method:'PUT',body:changes});
    const pending=await play(path);
    for(const [name,value] of Object.entries(changes))if(pending[name]!==value)throw Error('Play listing did not retain '+name);
    await play('/edits/'+encodeURIComponent(editId)+':commit',{method:'POST',body:{}});
    committed=true;editId='';
  }
  console.log(JSON.stringify({platform:'Google Play',changed:!identical,locale,fields:['title','shortDescription','fullDescription'],releaseTracksChanged:false,imagesChanged:false}));
}finally{
  if(editId&&!committed){try{await play('/edits/'+encodeURIComponent(editId),{method:'DELETE'});}catch{}}
}

// Verify the committed Google Play listing through a fresh, discarded edit.
let verifyEdit='';
try{
  const created=await play('/edits',{method:'POST',body:{}});
  verifyEdit=created.id;
  const confirmed=await play('/edits/'+encodeURIComponent(verifyEdit)+'/listings/'+locale);
  for(const [name,value] of Object.entries(googlePlay))if(confirmed[name]!==value)throw Error('Committed Google Play copy mismatch: '+name);
}finally{
  if(verifyEdit){try{await play('/edits/'+encodeURIComponent(verifyEdit),{method:'DELETE'});}catch{}}
}

// iOS 1.4 is already public. Promotional text alone is editable without a new
// binary; do not patch versioned description, keywords, screenshots or App Info.
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const unsigned=b64({alg:'ES256',kid,typ:'JWT'})+'.'+b64({iss,aud:'appstoreconnect-v1',iat:now,exp:now+900});
const signature=sign('sha256',Buffer.from(unsigned),{key:createPrivateKey(key),dsaEncoding:'ieee-p1363'}).toString('base64url');
const appleToken=unsigned+'.'+signature;
const asc=(path,opts)=>api('https://api.appstoreconnect.apple.com'+path,appleToken,opts);
const app=await asc('/v1/apps/'+appId+'?fields%5Bapps%5D=bundleId');
if(app.data?.attributes?.bundleId!==packageName)throw Error('Apple bundle ID changed');
const versions=await asc('/v1/apps/'+appId+'/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200');
const version=(versions.data||[]).find(v=>v.attributes?.versionString===liveIosVersion&&v.attributes?.platform==='IOS');
if(!version)throw Error('Public iOS 1.4 version not found');
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(!new Set(['READY_FOR_DISTRIBUTION','READY_FOR_SALE']).has(state))throw Error('Refusing promo edit on nonpublic iOS version: '+state);
const localized=await asc('/v1/appStoreVersions/'+encodeURIComponent(version.id)+'/appStoreVersionLocalizations?limit=200');
const vloc=(localized.data||[]).find(v=>v.attributes?.locale===locale);
if(!vloc)throw Error('Apple en-US localization missing');
const locPath='/v1/appStoreVersionLocalizations/'+encodeURIComponent(vloc.id);
if(vloc.attributes?.promotionalText!==apple.promotionalText){
  await asc(locPath,{method:'PATCH',body:{data:{type:'appStoreVersionLocalizations',id:vloc.id,attributes:{promotionalText:apple.promotionalText}}}});
}
const confirmed=await asc(locPath);
if(confirmed.data?.attributes?.promotionalText!==apple.promotionalText)throw Error('Apple promotional text verification failed');
console.log(JSON.stringify({platform:'App Store',liveVersion:liveIosVersion,locale,fields:['promotionalText'],descriptionAndKeywordsStagedForNextVersion:true,submitted:false,released:false}));
