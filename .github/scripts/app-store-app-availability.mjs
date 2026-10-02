import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const targetTerritories=['USA','CAN'];
const versionString='1.0';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const token=`${input}.${sig.toString('base64url')}`;

async function apiRaw(path,{method='GET',body}={}){
  const url=path.startsWith('https://')?path:`https://api.appstoreconnect.apple.com${path}`;
  const response=await fetch(url,{
    method,
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  return {ok:response.ok,status:response.status,text,data};
}
async function api(path,options={}){
  const result=await apiRaw(path,options);
  if(!result.ok)throw Error(`${options.method??'GET'} ${path} HTTP ${result.status}: ${result.text}`);
  return result.data;
}
function territoryIdsFromLegacy(doc){
  const relationship=doc?.data?.relationships?.availableTerritories?.data||[];
  return relationship.map(x=>x.id).filter(Boolean).sort();
}
function exactTarget(ids){
  return [...ids].sort().join(',')==='CAN,USA';
}
async function readLegacyAvailability(){
  const path=`/v1/apps/${appId}/appAvailability?include=availableTerritories&limit%5BavailableTerritories%5D=200`;
  const result=await apiRaw(path);
  if(result.status===404)return null;
  if(!result.ok)throw Error(`GET ${path} HTTP ${result.status}: ${result.text}`);
  return result.data;
}
async function readV2Availability(){
  const path=`/v1/apps/${appId}/appAvailabilityV2?fields%5BappAvailabilities%5D=availableInNewTerritories,territoryAvailabilities&include=territoryAvailabilities&fields%5BterritoryAvailabilities%5D=available,preOrderEnabled,territory&limit%5BterritoryAvailabilities%5D=50`;
  const result=await apiRaw(path);
  if(result.status===404)return null;
  if(!result.ok)throw Error(`GET ${path} HTTP ${result.status}: ${result.text}`);
  return result.data;
}
async function listV2Territories(availabilityId){
  const rows=[];
  let next=`/v2/appAvailabilities/${encodeURIComponent(availabilityId)}/territoryAvailabilities?fields%5BterritoryAvailabilities%5D=available,releaseDate,preOrderEnabled,preOrderPublishDate,contentStatuses,territory&include=territory&limit=200`;
  while(next){
    const page=await api(next);
    rows.push(...(page?.data||[]));
    next=page?.links?.next||null;
  }
  return rows;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const app=await api(`/v1/apps/${appId}`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');

const versions=await api(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType&limit=200`);
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error(`No iOS version ${versionString} found.`);
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(state!=='PREPARE_FOR_SUBMISSION')throw Error(`Refusing to change public availability while iOS ${versionString} state is ${state}.`);
if(version.attributes?.releaseType!=='MANUAL')throw Error(`Refusing to change public availability unless releaseType is MANUAL; found ${version.attributes?.releaseType}.`);

const existingV2=await readV2Availability();
if(existingV2){
  const rows=await listV2Territories(existingV2.data.id);
  if(rows.some(x=>x.attributes?.preOrderEnabled===true))throw Error('Refusing to modify availability while any territory has pre-order enabled.');
  const available=rows.filter(x=>x.attributes?.available===true).map(x=>x.relationships?.territory?.data?.id).filter(Boolean).sort();
  if(existingV2.data.attributes?.availableInNewTerritories===false&&exactTarget(available)){
    console.log(JSON.stringify({
      configured:true,
      alreadyConfigured:true,
      apiMode:'v2-existing',
      appId,bundleId,versionString,versionState:state,releaseType:version.attributes.releaseType,
      availabilityId:existingV2.data.id,
      availableInNewTerritories:false,
      availableTerritories:available,
      changedTerritoryCount:0,
      reviewSubmissionCreated:false,
      versionReleased:false,
      preOrderChanged:false,
    },null,2));
    process.exit(0);
  }
  throw Error(`Refusing to repurpose an existing v2 availability resource because that API surface is pre-order-oriented: ${JSON.stringify({availableInNewTerritories:existingV2.data.attributes?.availableInNewTerritories,available})}`);
}

const before=await readLegacyAvailability();
if(before){
  const beforeTerritories=territoryIdsFromLegacy(before);
  if(before.data?.attributes?.availableInNewTerritories===false&&exactTarget(beforeTerritories)){
    console.log(JSON.stringify({
      configured:true,
      alreadyConfigured:true,
      apiMode:'v1-legacy',
      appId,bundleId,versionString,versionState:state,releaseType:version.attributes.releaseType,
      availabilityId:before.data.id,
      availableInNewTerritories:false,
      availableTerritories:beforeTerritories,
      changedTerritoryCount:0,
      reviewSubmissionCreated:false,
      versionReleased:false,
      preOrderChanged:false,
    },null,2));
    process.exit(0);
  }
}

const configured=await api('/v1/appAvailabilities',{
  method:'POST',
  body:{data:{
    type:'appAvailabilities',
    attributes:{availableInNewTerritories:false},
    relationships:{
      app:{data:{type:'apps',id:appId}},
      availableTerritories:{data:targetTerritories.map(id=>({type:'territories',id}))},
    },
  }},
});
if(configured?.data?.type!=='appAvailabilities')throw Error('Legacy availability write returned an unexpected resource type.');

let final=null;
for(let attempt=1;attempt<=8;attempt++){
  final=await readLegacyAvailability();
  if(final){
    const ids=territoryIdsFromLegacy(final);
    if(final.data?.attributes?.availableInNewTerritories===false&&exactTarget(ids))break;
  }
  if(attempt===8)throw Error(`Legacy App Store availability did not settle to USA+CAN only: ${JSON.stringify(final)}`);
  await sleep(3000);
}

const finalTerritories=territoryIdsFromLegacy(final);
console.log(JSON.stringify({
  configured:true,
  alreadyConfigured:false,
  apiMode:'v1-legacy',
  appId,
  bundleId,
  versionString,
  versionState:state,
  releaseType:version.attributes.releaseType,
  availabilityId:final.data.id,
  availableInNewTerritories:final.data.attributes.availableInNewTerritories,
  availableTerritories:finalTerritories,
  changedTerritoryCount:targetTerritories.length,
  reviewSubmissionCreated:false,
  versionReleased:false,
  preOrderChanged:false,
},null,2));
