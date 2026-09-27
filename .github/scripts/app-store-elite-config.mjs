import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const appId='6814318676';
const bundleId='pro.packone.app';
const productId='pro.packone.app.elite.monthly';
const groupReferenceName='Pack One Elite';
const notificationUrl='https://api.packone.pro/growth/v1/apple-subscriptions/notifications';

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
  const data=text?JSON.parse(text):null;
  if(!r.ok)throw Error(`${method} ${path} HTTP ${r.status}: ${text}`);
  return data;
}
function one(data,pred){return (data?.data||[]).find(pred);}
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

const app=await api(`/v1/apps/${appId}?fields%5Bapps%5D=name,bundleId,subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store Connect bundle ID.');
const a=app.data.attributes;
if(a.subscriptionStatusUrl!==notificationUrl||a.subscriptionStatusUrlVersion!=='V2'||a.subscriptionStatusUrlForSandbox!==notificationUrl||a.subscriptionStatusUrlVersionForSandbox!=='V2'){
  await api(`/v1/apps/${appId}`,{method:'PATCH',body:{data:{type:'apps',id:appId,attributes:{
    subscriptionStatusUrl:notificationUrl,subscriptionStatusUrlVersion:'V2',
    subscriptionStatusUrlForSandbox:notificationUrl,subscriptionStatusUrlVersionForSandbox:'V2'
  }}}});
}

let groups=await api(`/v1/apps/${appId}/subscriptionGroups?fields%5BsubscriptionGroups%5D=referenceName&include=subscriptions&fields%5Bsubscriptions%5D=name,productId,subscriptionPeriod,familySharable,reviewNote,groupLevel,state&limit%5BsubscriptionGroups%5D=50&limit%5Bsubscriptions%5D=50`);
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

const finalApp=await api(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId,subscriptionStatusUrl,subscriptionStatusUrlVersion,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersionForSandbox`);
const finalSub=await api(`/v1/subscriptions/${subscription.id}?fields%5Bsubscriptions%5D=name,productId,subscriptionPeriod,familySharable,state,groupLevel`);

console.log(JSON.stringify({
  configured:true,appId,bundleId,groupId:group.id,groupVersionId:groupVersion.id,
  subscriptionId:subscription.id,subscriptionVersionId:subVersion.id,
  subscription:finalSub.data.attributes,notifications:finalApp.data.attributes,
  pricingConfigured:false,availabilityConfigured:false,reviewScreenshotConfigured:false
},null,2));
