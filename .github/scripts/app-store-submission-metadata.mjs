import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const versionString='1.0';
const locale='en-US';
const privacyChoicesUrl='https://packone.pro/privacy/#delete-account';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const token=`${input}.${sig.toString('base64url')}`;

async function api(path,{method='GET',body}={}){
  const response=await fetch(`https://api.appstoreconnect.apple.com${path}`,{
    method,
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}

const app=await api(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if(app?.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected bundle ID.');

const infos=await api(`/v1/apps/${appId}/appInfos?limit=50`);
const info=(infos?.data||[]).find(x=>['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW'].includes(x.attributes?.state||x.attributes?.appStoreState)) ?? infos?.data?.[0];
if(!info)throw Error('No App Store appInfo found.');

const locs=await api(`/v1/appInfos/${encodeURIComponent(info.id)}/appInfoLocalizations?limit=200`);
const loc=(locs?.data||[]).find(x=>x.attributes?.locale===locale);
if(!loc)throw Error(`No ${locale} appInfo localization found.`);

const versions=await api(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error(`No iOS version ${versionString} found.`);
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(!['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW'].includes(state))throw Error(`Version is not safely editable: ${state}`);

if(loc.attributes?.privacyChoicesUrl!==privacyChoicesUrl){
  await api(`/v1/appInfoLocalizations/${encodeURIComponent(loc.id)}`,{
    method:'PATCH',
    body:{data:{type:'appInfoLocalizations',id:loc.id,attributes:{privacyChoicesUrl}}},
  });
}
if(version.attributes?.releaseType!=='MANUAL'){
  await api(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`,{
    method:'PATCH',
    body:{data:{type:'appStoreVersions',id:version.id,attributes:{releaseType:'MANUAL'}}},
  });
}

const finalLoc=await api(`/v1/appInfoLocalizations/${encodeURIComponent(loc.id)}?fields%5BappInfoLocalizations%5D=locale,name,subtitle,privacyPolicyUrl,privacyChoicesUrl`);
const finalVersion=await api(`/v1/appStoreVersions/${encodeURIComponent(version.id)}?fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType`);

if(finalLoc.data?.attributes?.privacyChoicesUrl!==privacyChoicesUrl)throw Error('Privacy Choices URL did not settle.');
if(finalVersion.data?.attributes?.releaseType!=='MANUAL')throw Error('App Store release type did not settle to MANUAL.');

console.log(JSON.stringify({
  configured:true,
  appId,
  versionId:version.id,
  versionString,
  releaseType:finalVersion.data.attributes.releaseType,
  privacyPolicyUrl:finalLoc.data.attributes.privacyPolicyUrl,
  privacyChoicesUrl:finalLoc.data.attributes.privacyChoicesUrl,
  ageRatingChanged:false,
  reviewSubmissionCreated:false,
  releaseTriggered:false,
},null,2));
