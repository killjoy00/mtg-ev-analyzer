import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Exact-app, exact-version metadata patch. No binary, review or release mutation.
const data=JSON.parse(readFileSync(new URL('../pack-one-app-store-1.4.json',import.meta.url),'utf8'));
const {appId,bundleId,platform,version,locale,subtitle,description,keywords,promotionalText,whatsNew,marketingUrl,supportUrl}=data;
if(appId!=='6814318676'||bundleId!=='pro.packone.app'||platform!=='IOS'||version!=='1.4'||locale!=='en-US')throw Error('Unexpected App Store target');
if(subtitle.length>30||description.length>4000||promotionalText.length>170||Buffer.byteLength(keywords)>100)throw Error('App Store metadata length limit');
for(const link of ['https://www.apple.com/legal/internet-services/itunes/dev/stdeula/','https://packone.pro/terms/','https://packone.pro/privacy/'])if(!description.includes(link))throw Error('Missing legal link '+link);
if(!description||!keywords||!whatsNew)throw Error('Incomplete localized metadata');
const {ASC_KEY_ID: kid,ASC_ISSUER_ID: iss,ASC_PRIVATE_KEY: key}=process.env;
if(!kid||!iss||!key)throw Error('Missing App Store Connect credentials');
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const h=b64({alg:'ES256',kid,typ:'JWT'}),p=b64({iss,aud:'appstoreconnect-v1',iat:now,exp:now+900}),input=h+'.'+p;
const signature=sign('sha256',Buffer.from(input),{key:createPrivateKey(key),dsaEncoding:'ieee-p1363'}).toString('base64url');
const token=input+'.'+signature;
async function api(path,{method='GET',type,id,attributes}={}){
 const body=attributes?JSON.stringify({data:{type,id,attributes}}):undefined;
 const res=await fetch('https://api.appstoreconnect.apple.com'+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body});
 const text=await res.text();
 if(!res.ok)throw Error(method+' '+path+' HTTP '+res.status+': '+text.slice(0,800));
 return text?JSON.parse(text):null;
}
const app=await api('/v1/apps/'+appId+'?fields%5Bapps%5D=bundleId');
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Bundle ID mismatch');
const versions=await api('/v1/apps/'+appId+'/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200');
const selected=(versions.data||[]).find(x=>x.attributes?.versionString===version&&x.attributes?.platform==='IOS');
if(!selected)throw Error('iOS 1.4 not found');
const editable=new Set(['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW','INVALID_BINARY','REJECTED','METADATA_REJECTED','DEVELOPER_REJECTED']);
const state=selected.attributes?.appVersionState||selected.attributes?.appStoreState;
if(!editable.has(state))throw Error('Version 1.4 not editable: '+state);
const versionLocs=await api('/v1/appStoreVersions/'+encodeURIComponent(selected.id)+'/appStoreVersionLocalizations?limit=200');
const vloc=(versionLocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!vloc)throw Error('en-US 1.4 localization not found');
const infos=await api('/v1/apps/'+appId+'/appInfos?limit=50');
const info=(infos.data||[]).find(x=>x.attributes?.state==='PREPARE_FOR_SUBMISSION')||infos.data?.[0];
if(!info)throw Error('App info not found');
const ilocs=await api('/v1/appInfos/'+encodeURIComponent(info.id)+'/appInfoLocalizations?limit=200');
const iloc=(ilocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!iloc)throw Error('App info en-US localization not found');
// Preserve all other App Info fields, subscriptions, privacy answers, review status and release type.
await api('/v1/appInfoLocalizations/'+encodeURIComponent(iloc.id),{method:'PATCH',type:'appInfoLocalizations',id:iloc.id,attributes:{subtitle}});
const changes={description,keywords,marketingUrl,promotionalText,supportUrl,whatsNew};
await api('/v1/appStoreVersionLocalizations/'+encodeURIComponent(vloc.id),{method:'PATCH',type:'appStoreVersionLocalizations',id:vloc.id,attributes:changes});
const vi=await api('/v1/appStoreVersionLocalizations/'+encodeURIComponent(vloc.id));
const ai=await api('/v1/appInfoLocalizations/'+encodeURIComponent(iloc.id));
if(ai.data?.attributes?.subtitle!==subtitle)throw Error('Subtitle did not persist');
for(const [k,v] of Object.entries(changes))if(vi.data?.attributes?.[k]!==v)throw Error('Field did not persist: '+k);
console.log(JSON.stringify({updated:true,appId,version,locale,fields:Object.keys(changes).concat('subtitle'),submitted:false,released:false}));
