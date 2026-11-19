import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createAscTokenProvider } from './app-store-asset-upload-helpers.mjs';

const root = '.github/app-store-creative-assets';
const request = JSON.parse(readFileSync('.github/app-store-creative-upload-request.json', 'utf8'));
const expectedKeys = ['operation', 'appId', 'bundleId', 'versionString', 'locale', 'headerSha256', 'searchSha256'];
if (JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(expectedKeys.sort())) throw Error('Unexpected creative request keys');
if (request.operation !== 'upload-pack-one-14-header-and-search' ||
    request.appId !== '6814318676' || request.bundleId !== 'pro.packone.app' ||
    request.versionString !== '1.4' || request.locale !== 'en-US') throw Error('Invalid exact App Store target');

const getToken = createAscTokenProvider({
  issuerId: process.env.ASC_ISSUER_ID,
  keyId: process.env.ASC_KEY_ID,
  privateKeyText: process.env.ASC_PRIVATE_KEY,
});
const base = 'https://api.appstoreconnect.apple.com';
async function raw(path, method='GET', body) {
  if (!path.startsWith('/v1/')) throw Error('Unexpected Apple API path');
  const resp = await fetch(base+path, { method, headers: {
    Authorization: 'Bearer '+getToken(), Accept:'application/json',
    ...(body ? { 'Content-Type':'application/json' } : {})
  }, body:body?JSON.stringify(body):undefined, signal:AbortSignal.timeout(45000) });
  const text=await resp.text();
  let payload;try{payload=text?JSON.parse(text):null;}catch{payload=text;}
  return {ok:resp.ok,status:resp.status,payload,text};
}
async function api(path, method='GET', body) {
  const r=await raw(path,method,body);
  if(!r.ok)throw Error(method+' '+path+' failed HTTP '+r.status+' '+r.text.slice(0,900));
  return r.payload;
}
function imageSize(buffer) {
  const magic=Buffer.from([137,80,78,71,13,10,26,10]);
  if(buffer.subarray(0,8).equals(magic)) {
    if(buffer.length<26||buffer[25]!==2)throw Error('PNG must be opaque RGB');
    return [buffer.readUInt32BE(20),buffer.readUInt32BE(16)];
  }
  return jpegSize(buffer);
}
function jpegSize(buffer) {
  if(buffer[0]!==255||buffer[1]!==216)throw Error('Not JPEG');
  let n=2;
  while(n+12<buffer.length) {
    if(buffer[n]!==255){n++;continue;}
    while(buffer[n]===255)n++;
    const m=buffer[n++];
    if(m===217||m===218)break;
    const len=buffer.readUInt16BE(n);
    if([192,193,194,195,198,199,201,202,203,205,206,207].includes(m))
      return [buffer.readUInt16BE(n+3),buffer.readUInt16BE(n+5)]; // height,width
    if(len<2)break;
    n+=len;
  }
  throw Error('Missing JPEG dimensions');
}
const definitions=[
  {type:'PRODUCT_PAGE_HEADER_ASSET',file:root+'/pack-one-14-header.png',sourceFile:root+'/pack-one-14-header.jpg',sourceSha:request.headerSha256,
   width:3840,height:1646,name:'pack_one_appstore_header_v5_1_4.png'},
  {type:'APP_STORE_SEARCH_RESULTS_ASSET',file:root+'/pack-one-14-search.png',sourceFile:root+'/pack-one-14-search.jpg',sourceSha:request.searchSha256,
   width:3840,height:2560,name:'pack_one_appstore_search_results_v5_1_4.png'},
];
for(const x of definitions) {
  const source=readFileSync(x.sourceFile);
  if(createHash('sha256').update(source).digest('hex')!==x.sourceSha)throw Error('Unreviewed creative source bytes: '+x.sourceFile);
  x.buffer=readFileSync(x.file);
  const [h,w]=imageSize(x.buffer);
  if(w!==x.width||h!==x.height)throw Error('Bad Apple creative dimensions '+x.file+' '+w+'x'+h);
}

const app=await api('/v1/apps/'+request.appId+'?fields%5Bapps%5D=bundleId');
if(app.data?.attributes?.bundleId!==request.bundleId)throw Error('Bundle does not match Pack One');
const versions=await api('/v1/apps/'+request.appId+'/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200');
async function loc(versionString){
  const v=(versions.data||[]).filter(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
  if(v.length!==1)throw Error('Ambiguous iOS App Store version '+versionString);
  const state=v[0].attributes?.appVersionState||v[0].attributes?.appStoreState;
  const l=await api('/v1/appStoreVersions/'+v[0].id+'/appStoreVersionLocalizations?limit=200');
  const en=(l.data||[]).filter(x=>x.attributes?.locale==='en-US');
  if(en.length!==1)throw Error('Ambiguous localization for '+versionString);
  return {id:en[0].id,state};
}
const target=await loc('1.4'),live=await loc('1.3');
if(target.state!=='PREPARE_FOR_SUBMISSION')throw Error('1.4 is not in Prepare for Submission: '+target.state);
const library=await api('/v1/apps/'+request.appId+'/assetLibrary');
const libId=library.data?.id;if(!libId)throw Error('App Asset Library is missing');
async function placementList(id) {
  const r=await api('/v1/appStoreVersionLocalizations/'+id+'/placements?limit=200&include=image');
  return (r.data||[]).filter(p=>definitions.some(d=>d.type===p.attributes?.placementType));
}
const liveBefore=await placementList(live.id);
const liveFingerprint=JSON.stringify(liveBefore.map(p=>[p.id,p.attributes?.placementType,p.attributes?.placementGroup]).sort());
function locate(list,type) {
  const matched=list.filter(p=>p.attributes?.placementType===type);
  if(matched.length>1)throw Error('Multiple existing '+type+' placements');
  if(matched.length&&matched[0].attributes?.placementGroup!=='DEFAULT_PROFILE')throw Error('Unexpected placement group for '+type);
  return matched[0]||null;
}
async function placementAssetId(p) {
  if(!p)return null;
  if(p.relationships?.image?.data?.id)return p.relationships.image.data.id;
  const detail=await api('/v1/appAssetLibraryPlacements/'+p.id+'?include=image');
  if(detail.data?.relationships?.image?.data?.id)return detail.data.relationships.image.data.id;
  const rel=await api('/v1/appAssetLibraryPlacements/'+p.id+'/relationships/image');
  if(!rel.data?.id)throw Error('Cannot resolve existing creative placement asset '+p.id);
  return rel.data.id;
}
const existing=await placementList(target.id);
const oldPlacements=new Map();
for(const x of definitions) {
 const p=locate(existing,x.type),imageId=await placementAssetId(p);
 oldPlacements.set(x.type,{p,imageId});
}
console.log(JSON.stringify({preflight:true,appId:request.appId,version:'1.4',state:target.state,
  libraryId:libId,livePlacementCount:liveBefore.length,
  current1_4:[...oldPlacements].map(([type,v])=>({type,placement:v.p?.id||null,image:v.imageId||null}))}));

async function libraryImages() {
  const a=await api('/v1/appAssetLibraries/'+libId+'/images?limit=200');
  return a.data||[];
}
async function upload(x) {
  const prior=(await libraryImages()).filter(i=>i.attributes?.referenceName===x.name);
  if(prior.length>1)throw Error('Duplicate creative assets '+x.name);
  if(prior.length===1) {
    if(!['PREPARE_FOR_SUBMISSION','APPROVED'].includes(prior[0].attributes?.state))
      throw Error('Previously incomplete image '+x.name+': '+prior[0].attributes?.state);
    return prior[0].id;
  }
  const reserve=await api('/v1/appAssetLibraryImages','POST',{data:{
    type:'appAssetLibraryImages',attributes:{
      fileName:x.name,fileSize:x.buffer.length,category:'CREATIVE_ASSETS',referenceName:x.name
    },relationships:{assetLibrary:{data:{type:'appAssetLibraries',id:libId}}}
  }});
  const asset=reserve.data;
  if(!asset?.id||!Array.isArray(asset.attributes?.uploadOperations))throw Error('Apple failed to reserve '+x.name);
  for(const op of asset.attributes.uploadOperations) {
    const offset=Number(op.offset),length=Number(op.length);
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||
       offset+length>x.buffer.length)throw Error('Invalid upload range '+x.name);
    const hdr=Object.fromEntries((op.requestHeaders||[]).map(y=>[y.name,y.value]));
    const part=await fetch(op.url,{method:op.method,headers:hdr,body:x.buffer.subarray(offset,offset+length),
      signal:AbortSignal.timeout(60000)});
    if(!part.ok)throw Error('Apple blob upload '+x.name+' HTTP '+part.status+' '+(await part.text()).slice(0,300));
  }
  await api('/v1/appAssetLibraryImages/'+asset.id,'PATCH',{data:{
    type:'appAssetLibraryImages',id:asset.id,attributes:{uploaded:true}
  }});
  for(let attempt=0;attempt<90;attempt++) {
    const result=await api('/v1/appAssetLibraryImages/'+asset.id);
    const state=result.data?.attributes?.state;
    if(['PREPARE_FOR_SUBMISSION','APPROVED'].includes(state))return asset.id;
    if(state==='FAILED')throw Error('Image processing '+x.name+' FAILED: '+
      JSON.stringify(result.data?.attributes?.stateDetails));
    await new Promise(resolve=>setTimeout(resolve,2500));
  }
  throw Error('Timed out processing '+x.name);
}
async function createPlacement(type,imageId){
  const r=await api('/v1/appAssetLibraryPlacements','POST',{data:{
    type:'appAssetLibraryPlacements',
    attributes:{placementType:type,placementGroup:'DEFAULT_PROFILE'},
    relationships:{
      image:{data:{type:'appAssetLibraryImages',id:imageId}},
      appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:target.id}}
    }
  }});
  if(!r.data?.id)throw Error('Apple returned no placement ID '+type);
  return r.data.id;
}

// Upload and verify BOTH images before deleting either existing placement.
for(const x of definitions){x.newId=await upload(x);console.log(JSON.stringify({ready:true,type:x.type,imageId:x.newId}));}
for(const x of definitions){
  const {p,imageId}=oldPlacements.get(x.type);
  if(imageId===x.newId)continue;
  if(p) await api('/v1/appAssetLibraryPlacements/'+p.id,'DELETE');
  try {
    x.placementId=await createPlacement(x.type,x.newId);
  } catch(error) {
    if(p&&imageId) {
      try {
        const restored=await createPlacement(x.type,imageId);
        console.error('Restored original '+x.type+' placement as '+restored);
      } catch(rollbackError) {
        console.error('ROLLBACK FAILED for '+x.type+': '+rollbackError);
      }
    }
    throw error;
  }
}
const final=await placementList(target.id);
for(const x of definitions) {
  const p=locate(final,x.type);
  if(!p||await placementAssetId(p)!==x.newId)throw Error('Version 1.4 '+x.type+' did not persist');
}
const liveAfter=await placementList(live.id);
const afterFingerprint=JSON.stringify(liveAfter.map(p=>[p.id,p.attributes?.placementType,p.attributes?.placementGroup]).sort());
if(liveFingerprint!==afterFingerprint)throw Error('DANGER: the live 1.3 placement list changed');
console.log(JSON.stringify({uploaded:true,placed:true,appId:request.appId,version:'1.4',
  assets:definitions.map(x=>({type:x.type,newImageId:x.newId,placementId:locate(final,x.type).id})),
  live1_3_unchanged:true,submitted:false,released:false}));
