import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const productId='pro.packone.app.elite.monthly';
const groupReferenceName='Pack One Elite';
const notificationUrl='https://api.packone.pro/growth/v1/apple-subscriptions/notifications';
const targetTerritories=['USA','CAN'];
const targetUsPrice=7;
const planType='MONTHLY';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const token=`${input}.${sig.toString('base64url')}`;

async function api(path,{method='GET',body}={}){
  const r=await fetch(`https://api.appstoreconnect.apple.com${path}`,{
    method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined
  });
  const text=await r.text();
  let data=null;
  if(text){
    try{data=JSON.parse(text);}catch{data=text;}
  }
  if(!r.ok)throw Error(`${method} ${path} HTTP ${r.status}: ${text}`);
  return data;
}
function one(data,pred){return (data?.data||[]).find(pred);}
function sameStrings(a,b){return [...a].sort().join(',')===[...b].sort().join(',');}
async function ensureDraftVersion(parentType,parentId,versionType,collectionPath){
  const listed=await api(collectionPath);
  let v=one(listed,x=>x.attributes?.state==='PREPARE_FOR_SUBMISSION');
  if(v)return v;
  const relationshipKey=parentType==='subscriptionGroups'?'subscriptionGroup':'subscription';
  const created=await api(`/v1/${versionType}`,{method:'POST',body:{data:{type:versionType,relationships:{[relationshipKey]:{data:{type:parentType,id:parentId}}}}}});
  return created.data;
}
async function ensureGroupLocalization(versionId){
  const listed=await api(`/v1/subscriptionGroupVersions/${versionId}/localizations`);
  if(one(listed,x=>x.attributes?.locale==='en-US'))return;
  await api('/v2/subscriptionGroupLocalizations',{method:'POST',body:{data:{type:'subscriptionGroupLocalizations',attributes:{locale:'en-US',name:'Pack One Elite'},relationships:{version:{data:{type:'subscriptionGroupVersions',id:versionId}}}}}});
}
async function ensureSubscriptionLocalization(versionId){
  const listed=await api(`/v1/subscriptionVersions/${versionId}/localizations`);
  if(one(listed,x=>x.attributes?.locale==='en-US'))return;
  await api('/v2/subscriptionLocalizations',{method:'POST',body:{data:{type:'subscriptionLocalizations',attributes:{locale:'en-US',name:'Pack One Elite',description:'Powered Cube and custom-set practice.'},relationships:{version:{data:{type:'subscriptionVersions',id:versionId}}}}}});
}
async function ensurePlanAvailability(subscriptionId){
  const listed=await api(`/v1/subscriptions/${subscriptionId}/planAvailabilities?fields%5BsubscriptionPlanAvailabilities%5D=availableInNewTerritories,planType,availableTerritories&include=availableTerritories&limit=200&limit%5BavailableTerritories%5D=50`);
  let plan=one(listed,x=>x.attributes?.planType===planType);
  if(!plan){
    const created=await api('/v1/subscriptionPlanAvailabilities',{method:'POST',body:{data:{
      type:'subscriptionPlanAvailabilities',
      attributes:{planType,availableInNewTerritories:false},
      relationships:{
        subscription:{data:{type:'subscriptions',id:subscriptionId}},
        availableTerritories:{data:targetTerritories.map(id=>({type:'territories',id}))}
      }
    }}});
    return created.data;
  }
  if(plan.attributes?.availableInNewTerritories!==false){
    const updated=await api(`/v1/subscriptionPlanAvailabilities/${encodeURIComponent(plan.id)}`,{method:'PATCH',body:{data:{
      type:'subscriptionPlanAvailabilities',id:plan.id,attributes:{availableInNewTerritories:false}
    }}});
    plan=updated.data;
  }
  const available=await api(`/v1/subscriptionPlanAvailabilities/${encodeURIComponent(plan.id)}/availableTerritories?limit=50`);
  const ids=(available?.data||[]).map(x=>x.id);
  if(!sameStrings(ids,targetTerritories)){
    await api(`/v1/subscriptionPlanAvailabilities/${encodeURIComponent(plan.id)}/relationships/availableTerritories`,{
      method:'PATCH',
      body:{data:targetTerritories.map(id=>({type:'territories',id}))}
    });
  }
  return plan;
}
async function pricePointFor(subscriptionId,territory,customerPrice){
  const points=await api(`/v1/subscriptions/${subscriptionId}/pricePoints?filter%5Bterritory%5D=${territory}&fields%5BsubscriptionPricePoints%5D=customerPrice,territory&include=territory&limit=8000`);
  const exact=one(points,x=>Number(x.attributes?.customerPrice)===Number(customerPrice));
  if(exact)return exact;
  const nearby=(points?.data||[])
    .map(x=>Number(x.attributes?.customerPrice))
    .filter(Number.isFinite)
    .sort((a,b)=>Math.abs(a-customerPrice)-Math.abs(b-customerPrice))
    .slice(0,8);
  throw Error(`No ${territory} subscription price point equals ${customerPrice.toFixed(2)}. Nearest: ${nearby.join(', ')}`);
}
async function adjustedEqualization(basePricePointId,territory){
  const q=new URLSearchParams({
    'filter[upfrontPricePointId]':basePricePointId,
    'filter[planType]':planType,
    'filter[territory]':territory,
    'include':'territory',
    'fields[subscriptionPricePoints]':'customerPrice,territory',
    'limit':'200'
  });
  const result=await api(`/v1/subscriptionPricePoints/${encodeURIComponent(basePricePointId)}/adjustedEqualizations?${q}`);
  const point=one(result,x=>x.relationships?.territory?.data?.id===territory);
  if(!point)throw Error(`No adjusted ${territory} equalization returned for the selected USA price point.`);
  return point;
}
async function ensurePrice(subscriptionId,territory,pricePointId){
  const q=new URLSearchParams({
    'filter[territory]':territory,
    'filter[planType]':planType,
    'include':'territory,subscriptionPricePoint',
    'limit':'200'
  });
  const listed=await api(`/v1/subscriptions/${subscriptionId}/prices?${q}`);
  const existing=(listed?.data||[]).filter(x=>x.relationships?.territory?.data?.id===territory);
  if(existing.some(x=>x.relationships?.subscriptionPricePoint?.data?.id===pricePointId))return;
  if(existing.length){
    const summary=existing.map(x=>({
      id:x.id,startDate:x.attributes?.startDate??null,
      pricePointId:x.relationships?.subscriptionPricePoint?.data?.id??null
    }));
    throw Error(`Refusing to replace an existing ${territory} ${planType} price: ${JSON.stringify(summary)}`);
  }
  await api('/v1/subscriptionPrices',{method:'POST',body:{data:{
    type:'subscriptionPrices',
    attributes:{startDate:null,planType},
    relationships:{
      subscription:{data:{type:'subscriptions',id:subscriptionId}},
      subscriptionPricePoint:{data:{type:'subscriptionPricePoints',id:pricePointId}}
    }
  }}});
}

const app=await api(`/v1/apps/${appId}?fields%5Bapps%5D=name,bundleId,subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');
const a=app.data.attributes;
if(a.subscriptionStatusUrl!==notificationUrl||a.subscriptionStatusUrlVersion!=='V2'||a.subscriptionStatusUrlForSandbox!==notificationUrl||a.subscriptionStatusUrlVersionForSandbox!=='V2'){
  await api(`/v1/apps/${appId}`,{method:'PATCH',body:{data:{type:'apps',id:appId,attributes:{
    subscriptionStatusUrl:notificationUrl,subscriptionStatusUrlVersion:'V2',
    subscriptionStatusUrlForSandbox:notificationUrl,subscriptionStatusUrlVersionForSandbox:'V2'
  }}}});
}

let groups=await api(`/v1/apps/${appId}/subscriptionGroups?fields%5BsubscriptionGroups%5D=referenceName&include=subscriptions&fields%5Bsubscriptions%5D=name,productId,subscriptionPeriod,familySharable,reviewNote,groupLevel,state&limit=200&limit%5Bsubscriptions%5D=50`);
let group=one(groups,x=>x.attributes?.referenceName===groupReferenceName);
let subscription=one({data:groups.included||[]},x=>x.type==='subscriptions'&&x.attributes?.productId===productId);

if(subscription&&!group){
  const groupRel=subscription.relationships?.group?.data?.id;
  group=one(groups,x=>x.id===groupRel);
}
if(!group){
  const created=await api('/v1/subscriptionGroups',{method:'POST',body:{data:{type:'subscriptionGroups',attributes:{referenceName:groupReferenceName},relationships:{app:{data:{type:'apps',id:appId}}}}}});
  group=created.data;
}
const groupVersion=await ensureDraftVersion('subscriptionGroups',group.id,'subscriptionGroupVersions',`/v1/subscriptionGroups/${group.id}/versions`);
await ensureGroupLocalization(groupVersion.id);

if(!subscription){
  const created=await api('/v1/subscriptions',{method:'POST',body:{data:{type:'subscriptions',attributes:{
    name:'Pack One Elite Monthly',productId,subscriptionPeriod:'ONE_MONTH',familySharable:false,
    reviewNote:'Pack One Elite unlocks Powered Cube practice and custom-set practice for the signed-in Pack One account. Restore Purchases and Manage Subscription are available in the Membership screen.',
    groupLevel:1
  },relationships:{group:{data:{type:'subscriptionGroups',id:group.id}}}}}});
  subscription=created.data;
}
if(subscription.attributes?.productId!==productId)throw Error('Unexpected subscription product ID.');
if(subscription.attributes?.subscriptionPeriod&&subscription.attributes.subscriptionPeriod!=='ONE_MONTH')throw Error('Unexpected subscription period.');
if(subscription.attributes?.familySharable===true)throw Error('Family Sharing must remain disabled for Pack One Elite.');

const subVersion=await ensureDraftVersion('subscriptions',subscription.id,'subscriptionVersions',`/v1/subscriptions/${subscription.id}/versions`);
await ensureSubscriptionLocalization(subVersion.id);

const planAvailability=await ensurePlanAvailability(subscription.id);
const usaPricePoint=await pricePointFor(subscription.id,'USA',targetUsPrice);
const canPricePoint=await adjustedEqualization(usaPricePoint.id,'CAN');
await ensurePrice(subscription.id,'USA',usaPricePoint.id);
await ensurePrice(subscription.id,'CAN',canPricePoint.id);

const finalApp=await api(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId,subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox`);
const finalSub=await api(`/v1/subscriptions/${subscription.id}?fields%5Bsubscriptions%5D=name,productId,subscriptionPeriod,familySharable,state,groupLevel`);
const finalAvailability=await api(`/v1/subscriptionPlanAvailabilities/${encodeURIComponent(planAvailability.id)}/availableTerritories?limit=50`);
const finalPrices=await api(`/v1/subscriptions/${subscription.id}/prices?filter%5BplanType%5D=MONTHLY&include=territory,subscriptionPricePoint&limit=200`);

console.log(JSON.stringify({
  configured:true,appId,bundleId,groupId:group.id,groupVersionId:groupVersion.id,
  subscriptionId:subscription.id,subscriptionVersionId:subVersion.id,
  subscription:finalSub.data.attributes,notifications:finalApp.data.attributes,
  availability:{
    planType,
    availableInNewTerritories:false,
    territories:(finalAvailability?.data||[]).map(x=>x.id).sort()
  },
  pricing:{
    baseTerritory:'USA',
    requestedCustomerPrice:targetUsPrice.toFixed(2),
    usa:{pricePointId:usaPricePoint.id,customerPrice:usaPricePoint.attributes?.customerPrice},
    canada:{pricePointId:canPricePoint.id,customerPrice:canPricePoint.attributes?.customerPrice},
    configuredPrices:(finalPrices?.data||[]).map(x=>({
      territory:x.relationships?.territory?.data?.id,
      startDate:x.attributes?.startDate??null,
      planType:x.attributes?.planType,
      pricePointId:x.relationships?.subscriptionPricePoint?.data?.id
    }))
  },
  pricingConfigured:true,availabilityConfigured:true,reviewScreenshotConfigured:false
},null,2));
