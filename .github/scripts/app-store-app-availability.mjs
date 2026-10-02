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
const input=h+'.'+p;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const token=input+'.'+sig.toString('base64url');

async function apiRaw(path,{method='GET',body}={}){
  const url=path.startsWith('https://')?path:'https://api.appstoreconnect.apple.com'+path;
  const response=await fetch(url,{
    method,
    headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  return {ok:response.ok,status:response.status,text,data};
}
async function api(path,options={}){
  const result=await apiRaw(path,options);
  if(!result.ok)throw Error((options.method??'GET')+' '+path+' HTTP '+result.status+': '+result.text);
  return result.data;
}
async function readV2Availability(){
  const path='/v1/apps/'+appId+'/appAvailabilityV2?fields%5BappAvailabilities%5D=availableInNewTerritories,territoryAvailabilities';
  const result=await apiRaw(path);
  if(result.status===404)return null;
  if(!result.ok)throw Error('GET '+path+' HTTP '+result.status+': '+result.text);
  return result.data;
}
async function listV2Territories(availabilityId){
  const rows=[];
  let next='/v2/appAvailabilities/'+encodeURIComponent(availabilityId)+'/territoryAvailabilities?fields%5BterritoryAvailabilities%5D=available,releaseDate,preOrderEnabled,preOrderPublishDate,contentStatuses,territory&include=territory&limit=200';
  while(next){
    const page=await api(next);
    rows.push(...(page?.data||[]));
    next=page?.links?.next||null;
  }
  return rows;
}
function territoryId(row){
  return row.relationships?.territory?.data?.id||null;
}
function availableTerritories(rows){
  return rows.filter(row=>row.attributes?.available===true).map(territoryId).filter(Boolean).sort();
}
function exactTarget(ids){
  return [...ids].sort().join(',')==='CAN,USA';
}
function preorderEvidence(rows){
  return rows.filter(row=>{
    if(row.attributes?.preOrderEnabled===true)return true;
    const statuses=row.attributes?.contentStatuses||[];
    return statuses.some(status=>String(status).includes('PREORDER'));
  }).map(row=>({territory:territoryId(row),attributes:row.attributes}));
}
function assertFinal(availability,rows){
  const available=availableTerritories(rows);
  const preorder=preorderEvidence(rows);
  if(availability?.attributes?.availableInNewTerritories!==false){
    throw Error('availableInNewTerritories did not settle to false.');
  }
  if(!exactTarget(available)){
    throw Error('App Store availability is not exactly USA+CAN: '+JSON.stringify(available));
  }
  if(preorder.length){
    throw Error('Unexpected App Store pre-order state: '+JSON.stringify(preorder));
  }
  return available;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const app=await api('/v1/apps/'+appId);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');

const versions=await api('/v1/apps/'+appId+'/appStoreVersions?filter%5Bplatform%5D=IOS&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType&limit=200');
const version=(versions?.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error('No iOS version '+versionString+' found.');
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(state!=='PREPARE_FOR_SUBMISSION')throw Error('Refusing to change public availability while iOS '+versionString+' state is '+state+'.');
if(version.attributes?.releaseType!=='MANUAL')throw Error('Refusing to change public availability unless releaseType is MANUAL; found '+version.attributes?.releaseType+'.');

let availability=await readV2Availability();
if(availability){
  const rows=await listV2Territories(availability.data.id);
  const available=assertFinal(availability.data,rows);
  console.log(JSON.stringify({
    configured:true,
    alreadyConfigured:true,
    apiMode:'v2',
    appId,bundleId,versionString,versionState:state,releaseType:version.attributes.releaseType,
    availabilityId:availability.data.id,
    availableInNewTerritories:false,
    availableTerritories:available,
    preorderEnabled:false,
    changedTerritoryCount:0,
    reviewSubmissionCreated:false,
    versionReleased:false,
  },null,2));
  process.exit(0);
}

const localId=id=>'+id+';
const refs=targetTerritories.map(id=>({type:'territoryAvailabilities',id:localId(id)}));
const included=targetTerritories.map(id=>({
  type:'territoryAvailabilities',
  id:localId(id),
  attributes:{
    available:true,
    preOrderEnabled:false,
  },
  relationships:{
    territory:{data:{type:'territories',id}},
  },
}));

const created=await api('/v2/appAvailabilities',{
  method:'POST',
  body:{
    data:{
      type:'appAvailabilities',
      attributes:{availableInNewTerritories:false},
      relationships:{
        app:{data:{type:'apps',id:appId}},
        territoryAvailabilities:{data:refs},
      },
    },
    included,
  },
});
if(created?.data?.type!=='appAvailabilities'||!created?.data?.id){
  throw Error('App availability creation returned an unexpected resource.');
}

let finalAvailability=null;
let finalRows=null;
let finalAvailable=null;
for(let attempt=1;attempt<=8;attempt++){
  finalAvailability=await readV2Availability();
  if(finalAvailability){
    finalRows=await listV2Territories(finalAvailability.data.id);
    try{
      finalAvailable=assertFinal(finalAvailability.data,finalRows);
      break;
    }catch(error){
      if(attempt===8)throw error;
    }
  }else if(attempt===8){
    throw Error('App availability was created but is not readable through appAvailabilityV2.');
  }
  await sleep(3000);
}

console.log(JSON.stringify({
  configured:true,
  alreadyConfigured:false,
  apiMode:'v2',
  appId,
  bundleId,
  versionString,
  versionState:state,
  releaseType:version.attributes.releaseType,
  availabilityId:finalAvailability.data.id,
  availableInNewTerritories:false,
  availableTerritories:finalAvailable,
  preorderEnabled:false,
  changedTerritoryCount:targetTerritories.length,
  reviewSubmissionCreated:false,
  versionReleased:false,
},null,2));
