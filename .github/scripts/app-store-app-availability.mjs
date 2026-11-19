import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const versionString='1.0';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const token=`${input}.${sig.toString('base64url')}`;

async function api(path){
  const url=path.startsWith('https://')?path:`https://api.appstoreconnect.apple.com${path}`;
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const text=await response.text();
  if(!response.ok)throw Error(`GET ${path} HTTP ${response.status}: ${text}`);
  return text?JSON.parse(text):null;
}

async function listAll(path){
  const rows=[];
  let next=path;
  while(next){
    const page=await api(next);
    rows.push(...(page?.data||[]));
    next=page?.links?.next||null;
  }
  return rows;
}

const app=await api(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');

const versions=await api(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType&limit=200`);
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error(`No iOS version ${versionString} found.`);

const availabilityDoc=await api(`/v1/apps/${appId}/appAvailabilityV2?fields%5BappAvailabilities%5D=availableInNewTerritories,territoryAvailabilities`);
const availability=availabilityDoc?.data;
if(!availability?.id)throw Error('App availability resource is missing after owner setup.');

const rows=await listAll(`/v2/appAvailabilities/${encodeURIComponent(availability.id)}/territoryAvailabilities?fields%5BterritoryAvailabilities%5D=available,releaseDate,preOrderEnabled,preOrderPublishDate,contentStatuses,territory&include=territory&limit=200`);
const available=rows
  .filter(x=>x.attributes?.available===true)
  .map(x=>x.relationships?.territory?.data?.id)
  .filter(Boolean)
  .sort();
const preorder=rows.filter(x=>{
  if(x.attributes?.preOrderEnabled===true)return true;
  return (x.attributes?.contentStatuses||[]).some(status=>String(status).includes('PREORDER'));
}).map(x=>x.relationships?.territory?.data?.id).filter(Boolean);

if(availability.attributes?.availableInNewTerritories!==false){
  throw Error('Expected availableInNewTerritories=false after choosing Specific Countries or Regions.');
}
if(available.join(',')!=='CAN,USA'){
  throw Error(`Expected App Store availability CAN,USA only; found ${JSON.stringify(available)}`);
}
if(preorder.length){
  throw Error(`Unexpected App Store pre-order state in territories: ${JSON.stringify(preorder)}`);
}

console.log(JSON.stringify({
  verified:true,
  readOnly:true,
  appId,
  bundleId,
  versionString,
  versionState:version.attributes?.appVersionState,
  releaseType:version.attributes?.releaseType,
  availabilityId:availability.id,
  availableInNewTerritories:false,
  availableTerritories:available,
  preOrderTerritories:preorder,
},null,2));
