import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();
const appId='6814318676';
const bundleId='pro.packone.app';
const packageName='pro.packone.app';
const versionString='1.0';
const locale='en-US';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');
if(!playToken)throw Error('PLAY_ACCESS_TOKEN is required.');

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const header=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const payload=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${header}.${payload}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const ascToken=`${input}.${sig.toString('base64url')}`;

async function asc(path,{method='GET',body,allow404=false}={}){
  const response=await fetch(`https://api.appstoreconnect.apple.com${path}`,{
    method,
    headers:{Authorization:`Bearer ${ascToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}
async function play(path,{method='GET',body,allow404=false}={}){
  const response=await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}${path}`,{
    method,
    headers:{Authorization:`Bearer ${playToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}

const app=await asc(`/v1/apps/${appId}?fields%5Bapps%5D=name,bundleId,sku,primaryLocale,contentRightsDeclaration,isOrEverWasMadeForKids`);
if(app?.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store bundle ID.');

const appInfos=await asc(`/v1/apps/${appId}/appInfos?limit=50`);
if(!appInfos?.data?.length)throw Error('No App Store appInfo resources found.');
const appInfo=appInfos.data[0];

const appInfoLocalizations=await asc(`/v1/appInfos/${encodeURIComponent(appInfo.id)}/appInfoLocalizations?limit=200`);
const appInfoLocalization=(appInfoLocalizations?.data||[]).find(x=>x.attributes?.locale===locale)??null;
const ageRating=await asc(`/v1/appInfos/${encodeURIComponent(appInfo.id)}/ageRatingDeclaration`);

const versions=await asc(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error(`iOS App Store version ${versionString} not found.`);

const versionLocalizations=await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`);
const versionLocalization=(versionLocalizations?.data||[]).find(x=>x.attributes?.locale===locale)??null;
const review=await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreReviewDetail`,{allow404:true});

let editId='';
let playDetails=null;
let playListing=null;
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  editId=edit?.id||'';
  if(!editId)throw Error('Google Play edit did not return id.');
  playDetails=await play(`/edits/${editId}/details`);
  playListing=await play(`/edits/${editId}/listings/${locale}`,{allow404:true});
} finally {
  if(editId){
    try{await play(`/edits/${editId}`,{method:'DELETE'});}catch(e){console.error('Temporary Play edit cleanup failed:',String(e));}
  }
}

const reviewAttrs=review?.data?.attributes??null;
const safeReview=reviewAttrs?{
  contactFirstName:reviewAttrs.contactFirstName??null,
  contactLastName:reviewAttrs.contactLastName??null,
  contactPhoneConfigured:Boolean(reviewAttrs.contactPhone),
  contactEmail:reviewAttrs.contactEmail??null,
  demoAccountRequired:reviewAttrs.demoAccountRequired??null,
  demoAccountNameConfigured:Boolean(reviewAttrs.demoAccountName),
  demoAccountPasswordConfigured:Boolean(reviewAttrs.demoAccountPassword),
  notes:reviewAttrs.notes??null,
}:null;

console.log(JSON.stringify({
  apple:{
    app:{id:app.data.id,attributes:app.data.attributes},
    appInfo:{id:appInfo.id,attributes:appInfo.attributes},
    appInfoLocalization:appInfoLocalization?{id:appInfoLocalization.id,attributes:appInfoLocalization.attributes}:null,
    ageRating:{id:ageRating?.data?.id??null,attributes:ageRating?.data?.attributes??null},
    version:{id:version.id,attributes:version.attributes},
    versionLocalization:versionLocalization?{id:versionLocalization.id,attributes:versionLocalization.attributes}:null,
    review:safeReview,
  },
  googlePlay:{
    details:playDetails??null,
    listing:playListing??null,
  },
},null,2));
