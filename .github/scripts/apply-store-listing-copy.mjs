// Apply only the reviewed iOS 1.5 versioned copy and Google Play en-US listing text.
// Do not alter live iOS 1.4, App Info, builds, screenshots, release tracks or review status.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const {locale,apple,googlePlay}=JSON.parse(readFileSync(new URL('../pack-one-store-copy-en-US.json',import.meta.url),'utf8'));
const appId='6814318676';
const bundleId='pro.packone.app';
const appleVersion='1.5';
if(locale!=='en-US'||apple.version!==appleVersion||apple.name!=='Pack One'||googlePlay.title!=='Pack One: Draft Challenge'){
  throw Error('Unexpected store app, locale or version');
}
if(apple.subtitle!=='Daily Limited Draft Challenge')throw Error('Unexpected Apple subtitle');
if(apple.description.length>4000||Buffer.byteLength(apple.keywords,'utf8')>100||apple.promotionalText.length>170)throw Error('Apple copy length exceeded');
if(googlePlay.title.length>30||googlePlay.shortDescription.length>80||googlePlay.fullDescription.length>4000)throw Error('Play copy length exceeded');
if(!googlePlay.shortDescription.includes('Pack 1')||!apple.keywords.split(',').includes('pack1'))throw Error('Required alias missing');
for(const url of [
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
  'https://packone.pro/terms/',
  'https://packone.pro/privacy/'
])if(!apple.description.includes(url))throw Error('Apple legal link missing: '+url);

const {ASC_KEY_ID:kid,ASC_ISSUER_ID:iss,ASC_PRIVATE_KEY:key,PLAY_ACCESS_TOKEN:playToken}=process.env;
if(!kid||!iss||!key||!playToken)throw Error('Protected store credentials are required');

async function request(url,token,{method='GET',body}={}){
  const response=await fetch(url,{
    method,
    headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const raw=await response.text();
  if(!response.ok)throw Error(method+' '+url.split('?')[0]+' returned HTTP '+response.status+': '+raw.slice(0,500));
  return raw?JSON.parse(raw):null;
}
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const unsigned=b64({alg:'ES256',kid,typ:'JWT'})+'.'+b64({iss,aud:'appstoreconnect-v1',iat:now,exp:now+900});
const signature=sign('sha256',Buffer.from(unsigned),{key:createPrivateKey(key),dsaEncoding:'ieee-p1363'}).toString('base64url');
const asc=(path,options)=>request('https://api.appstoreconnect.apple.com'+path,unsigned+'.'+signature,options);
const play=(path,options)=>request('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+bundleId+path,playToken,options);

// Preflight Apple first: the owner created iOS 1.5; never create or modify a version record.
const app=await asc('/v1/apps/'+appId+'?fields%5Bapps%5D=bundleId');
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store bundle ID');
const versions=await asc('/v1/apps/'+appId+'/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200');
const selected=(versions.data||[]).find(x=>x.attributes?.versionString===appleVersion&&x.attributes?.platform==='IOS');
if(!selected)throw Error('Owner-created iOS 1.5 record is missing. No changes applied.');
const state=selected.attributes?.appVersionState||selected.attributes?.appStoreState;
const editable=new Set(['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW','INVALID_BINARY','REJECTED','METADATA_REJECTED','DEVELOPER_REJECTED']);
if(!editable.has(state))throw Error('iOS 1.5 version cannot be edited in state '+state);
const localizations=await asc('/v1/appStoreVersions/'+encodeURIComponent(selected.id)+'/appStoreVersionLocalizations?limit=200');
const localization=(localizations.data||[]).find(x=>x.attributes?.locale===locale);
if(!localization)throw Error('iOS 1.5 en-US localization not found');
const applePath='/v1/appStoreVersionLocalizations/'+encodeURIComponent(localization.id);
const appleChanges={
  description:apple.description,
  keywords:apple.keywords,
  promotionalText:apple.promotionalText,
  marketingUrl:'https://packone.pro/',
  supportUrl:'https://packone.pro/contact/',
};
const applePrevious=await asc(applePath);

// Preflight Play too, before any provider writes.
let editId='';
let committed=false;
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  editId=edit.id;
  if(!editId)throw Error('No Play edit ID');
  const playPath='/edits/'+encodeURIComponent(editId)+'/listings/'+locale;
  const prior=await play(playPath);
  if(prior.language&&prior.language!==locale)throw Error('Unexpected Play listing language');
  if(!['Pack One',googlePlay.title].includes(prior.title))throw Error('Play title changed from the reviewed baseline');
  const playChanges={
    language:locale,
    title:googlePlay.title,
    shortDescription:googlePlay.shortDescription,
    fullDescription:googlePlay.fullDescription,
  };
  if(typeof prior.video==='string'&&prior.video)playChanges.video=prior.video;

  // Apple changes target only iOS 1.5's version localization. Do not set What's New
  // (release-specific), global name/subtitle, release type or build attachments.
  if(Object.entries(appleChanges).some(([k,v])=>applePrevious.data?.attributes?.[k]!==v)){
    await asc(applePath,{method:'PATCH',body:{data:{type:'appStoreVersionLocalizations',id:localization.id,attributes:appleChanges}}});
  }
  const appleVerified=await asc(applePath);
  for(const [key,value] of Object.entries(appleChanges)){
    if(appleVerified.data?.attributes?.[key]!==value)throw Error('iOS 1.5 metadata mismatch: '+key);
  }

  const needsPlay=Object.entries(playChanges).some(([k,v])=>prior[k]!==v);
  if(needsPlay){
    await play(playPath,{method:'PUT',body:playChanges});
    const pending=await play(playPath);
    for(const [k,v] of Object.entries(playChanges))if(pending[k]!==v)throw Error('Pending Play metadata mismatch: '+k);
    await play('/edits/'+encodeURIComponent(editId)+':commit',{method:'POST',body:{}});
    committed=true;
    editId='';
  }
  console.log(JSON.stringify({apple:{version:appleVersion,fields:Object.keys(appleChanges),submitted:false,released:false},googlePlay:{changed:needsPlay,fields:['title','shortDescription','fullDescription'],trackChanges:false}}));
}finally{
  if(editId&&!committed){try{await play('/edits/'+encodeURIComponent(editId),{method:'DELETE'});}catch{}}
}

// Read-back committed Play data in a fresh temporary edit and discard it.
let verificationEdit='';
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  verificationEdit=edit.id;
  const listing=await play('/edits/'+encodeURIComponent(verificationEdit)+'/listings/'+locale);
  for(const [key,value] of Object.entries(googlePlay))if(listing[key]!==value)throw Error('Committed Play metadata mismatch: '+key);
}finally{
  if(verificationEdit){try{await play('/edits/'+encodeURIComponent(verificationEdit),{method:'DELETE'});}catch{}}
}
