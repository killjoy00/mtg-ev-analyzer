import {createPrivateKey,sign} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
// Read-only: GET from App Store Connect; no API mutations.
const id='6814318676', {ASC_KEY_ID:kid,ASC_ISSUER_ID:iss,ASC_PRIVATE_KEY:key}=process.env;
if(!kid||!iss||!key)throw Error('Missing App Store Connect credentials');
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
const unsigned=b64({alg:'ES256',kid,typ:'JWT'})+'.'+b64({iss,aud:'appstoreconnect-v1',iat:now,exp:now+900});
const token=unsigned+'.'+sign('sha256',Buffer.from(unsigned),{key:createPrivateKey(key),dsaEncoding:'ieee-p1363'}).toString('base64url');
async function api(path){
 if(!path.startsWith('/v1/'))throw Error('Unexpected path');
 const r=await fetch('https://api.appstoreconnect.apple.com'+path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const text=await r.text();if(!r.ok)throw Error('GET '+path+' HTTP '+r.status+': '+text.slice(0,450));return JSON.parse(text);
}
const base='app-store-creative-audit';await mkdir(base,{recursive:true});
const app=await api('/v1/apps/'+id+'?fields%5Bapps%5D=bundleId');
if(app.data?.attributes?.bundleId!=='pro.packone.app')throw Error('App ID mismatch');
const versions=await api('/v1/apps/'+id+'/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200');
const summary={appId:id,date:new Date().toISOString(),versions:[],library:null,previews:[],errors:[]},images=new Map();
for(const version of (versions.data||[]).filter(v=>v.attributes?.platform==='IOS').slice(0,12)){
 const v={version:version.attributes.versionString,state:version.attributes.appVersionState||version.attributes.appStoreState,locales:[]};summary.versions.push(v);
 try{
  const locs=await api('/v1/appStoreVersions/'+version.id+'/appStoreVersionLocalizations?limit=200');
  for(const loc of (locs.data||[]).filter(x=>x.attributes?.locale==='en-US')){
   const l={locale:'en-US',assets:[]};v.locales.push(l);
   const placements=await api('/v1/appStoreVersionLocalizations/'+loc.id+'/placements?limit=200');
   for(const p of placements.data||[]){
    const type=p.attributes?.placementType||'';
    if(!['PRODUCT_PAGE_HEADER_ASSET','APP_STORE_SEARCH_RESULTS_ASSET'].includes(type))continue;
    const imageId=p.relationships?.image?.data?.id||null;
    l.assets.push({type,group:p.attributes?.placementGroup,state:p.attributes?.state,mediaType:p.attributes?.mediaType,imageId});
    if(imageId)images.set(imageId,{version:v.version,type});
   }
  }
 }catch(e){v.error=String(e.message);summary.errors.push({version:v.version,error:v.error});}
}
try{
 const library=await api('/v1/apps/'+id+'/assetLibrary');
 summary.library={id:library.data?.id,creativeImages:[]};
 if(library.data?.id){
  let path='/v1/appAssetLibraries/'+library.data.id+'/images?limit=200&filter%5Bcategory%5D=CREATIVE_ASSETS';
  for(let n=0;n<5&&path;n++){
   const page=await api(path);
   for(const x of page.data||[]){
    summary.library.creativeImages.push({id:x.id,name:x.attributes?.referenceName,fileName:x.attributes?.fileName,state:x.attributes?.state});
    if(images.size<15&&!images.has(x.id))images.set(x.id,{source:'unplaced library creative'});
   }
   const next=page.links?.next;path=next?new URL(next).pathname+new URL(next).search:null;
  }
 }
}catch(e){summary.errors.push({library:String(e.message)});}
for(const [imageId,source] of images){
 try{
  const x=await api('/v1/appAssetLibraryImages/'+imageId);
  const a=x.data?.attributes||{},im=a.imageAsset||{},p={imageId,...source,name:a.referenceName,fileName:a.fileName,state:a.state,width:im.width,height:im.height};
  if(im.templateUrl&&im.width&&im.height){
   const w=Math.min(im.width,1920),h=Math.round(w*im.height/im.width);
   const u=im.templateUrl.replace('{w}',String(w)).replace('{h}',String(h)).replace('{f}','jpg');
   const r=await fetch(u,{signal:AbortSignal.timeout(45000)});
   if(!r.ok)throw Error('Image CDN HTTP '+r.status);
   const filename='image-'+summary.previews.length+'.jpg';
   await writeFile(base+'/'+filename,new Uint8Array(await r.arrayBuffer()));p.preview=filename;
  }
  summary.previews.push(p);
 }catch(e){summary.errors.push({imageId,error:String(e.message)});}
}
await writeFile(base+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({versions:summary.versions,libraryCreativeCount:summary.library?.creativeImages.length??null,previews:summary.previews,errors:summary.errors},null,2));
