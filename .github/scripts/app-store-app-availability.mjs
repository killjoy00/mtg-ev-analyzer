import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const targetTerritories=new Set(['USA','CAN']);
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
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const app=await api(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');

const versions=await api(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error(`No iOS version ${versionString} found.`);
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(state!=='PREPARE_FOR_SUBMISSION')throw Error(`Refusing to change public availability while iOS ${versionString} state is ${state}.`);
if(version.attributes?.releaseType&&version.attributes.releaseType!=='MANUAL')throw Error(`Refusing to change public availability unless releaseType is MANUAL; found ${version.attributes.releaseType}.`);

const availabilityLink=await api(`/v1/apps/${appId}/appAvailabilityV2?fields%5BappAvailabilities%5D=availableInNewTerritories,territoryAvailabilities`);
const availability=availabilityLink?.data;
if(!availability?.id)throw Error('App availability resource is missing; refusing to create a pre-order or new availability resource.');

const before=await listAll(`/v2/appAvailabilities/${encodeURIComponent(availability.id)}/territoryAvailabilities?fields%5BterritoryAvailabilities%5D=available,releaseDate,preOrderEnabled,preOrderPublishDate,contentStatuses,territory&include=territory&limit=200`);
if(before.length<2)throw Error(`Unexpected territory availability count: ${before.length}`);
if(before.some(x=>x.attributes?.preOrderEnabled===true))throw Error('Refusing to modify availability while any territory has pre-order enabled.');

if(availability.attributes?.availableInNewTerritories!==false){
  await api(`/v1/apps/${appId}`,{
    method:'PATCH',
    body:{data:{type:'apps',id:appId,attributes:{availableInNewTerritories:false}}},
  });
}

let changed=0;
for(const row of before){
  const territory=row.relationships?.territory?.data?.id;
  if(!territory)throw Error(`Territory relationship missing for availability ${row.id}`);
  const desired=targetTerritories.has(territory);
  if(Boolean(row.attributes?.available)===desired)continue;
  await api(`/v1/territoryAvailabilities/${encodeURIComponent(row.id)}`,{
    method:'PATCH',
    body:{data:{type:'territoryAvailabilities',id:row.id,attributes:{available:desired}}},
  });
  changed+=1;
}

let finalRows=null;
let finalAvailability=null;
for(let attempt=1;attempt<=8;attempt++){
  finalAvailability=await api(`/v1/apps/${appId}/appAvailabilityV2?fields%5BappAvailabilities%5D=availableInNewTerritories,territoryAvailabilities`);
  finalRows=await listAll(`/v2/appAvailabilities/${encodeURIComponent(availability.id)}/territoryAvailabilities?fields%5BterritoryAvailabilities%5D=available,releaseDate,preOrderEnabled,preOrderPublishDate,contentStatuses,territory&include=territory&limit=200`);
  const available=finalRows
    .filter(x=>x.attributes?.available===true)
    .map(x=>x.relationships?.territory?.data?.id)
    .filter(Boolean)
    .sort();
  if(finalAvailability.data?.attributes?.availableInNewTerritories===false&&available.join(',')==='CAN,USA')break;
  if(attempt===8)throw Error(`App availability did not settle to USA+CAN only: ${JSON.stringify({availableInNewTerritories:finalAvailability.data?.attributes?.availableInNewTerritories,available})}`);
  await sleep(5000);
}

const availableTerritories=finalRows
  .filter(x=>x.attributes?.available===true)
  .map(x=>x.relationships?.territory?.data?.id)
  .filter(Boolean)
  .sort();

console.log(JSON.stringify({
  configured:true,
  appId,
  bundleId,
  versionString,
  versionState:state,
  releaseType:version.attributes?.releaseType??'MANUAL',
  availabilityId:availability.id,
  availableInNewTerritories:finalAvailability.data.attributes.availableInNewTerritories,
  availableTerritories,
  changedTerritoryCount:changed,
  reviewSubmissionCreated:false,
  versionReleased:false,
  preOrderChanged:false,
},null,2));
