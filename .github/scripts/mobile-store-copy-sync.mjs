import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();
const appId='6814318676';
const bundleId='pro.packone.app';
const packageName='pro.packone.app';
const versionString='1.0';
const locale='en-US';

if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');
if(!playToken)throw Error('PLAY_ACCESS_TOKEN is required.');

const apple={
  subtitle:'Practice real draft decisions',
  promotionalText:'Make eight picks from real trophy drafts, compare your choices with the original drafter and model-supported alternatives, and build your Pack One career.',
  keywords:'limited,draft,card,booster,pick,practice,strategy,leaderboard,training,trophy',
  marketingUrl:'https://packone.pro/',
  supportUrl:'https://packone.pro/contact/',
  description:"Pack One is a short Limited draft-decision game built from real trophy drafts.\n\nMake eight picks with the original drafter's earlier cards visible. Lock each choice before you see the trophy drafter's pick and Pack One's model-supported alternatives. Matching the trophy pick earns 100 points; strong alternatives can still receive partial credit.\n\nThree fixed Daily challenges refresh each day:\n- Daily Draft Run\n- Daily Powered Cube\n- Daily Latest Set\n\nEveryone gets the same decisions for each Daily, so scores are directly comparable.\n\nKeep practicing between Dailies with regular random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity.\n\nYour Pack One account works across web, iPhone, iPad, and Android. Sign in with Apple, Google, or email. Account deletion is available in the app.\n\nPack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.",
};
const google={
  title:'Pack One',
  shortDescription:'Practice real draft decisions, compare trophy picks, and track your career.',
  fullDescription:"Pack One turns real trophy drafts into short, repeatable draft-decision practice.\n\nMake eight picks with the original drafter's earlier cards visible. Lock your choice, then compare it with the trophy drafter's actual pick and Pack One's model-supported alternatives.\n\nThree fixed Daily challenges refresh each day:\n- Daily Draft Run\n- Daily Powered Cube\n- Daily Latest Set\n\nEveryone gets the same Daily decisions, so scores are directly comparable.\n\nPractice between Dailies with random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity. Existing Elite access unlocks Powered Cube and custom-set practice.\n\nUse the same Pack One identity on web, iPhone, and Android with Apple, Google, or email sign-in. Permanent account deletion is available in the app.\n\nPack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.",
};

function b64(value){return Buffer.from(value).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const ascToken=`${input}.${sig.toString('base64url')}`;

async function asc(path,{method='GET',body}={}){
  const response=await fetch(`https://api.appstoreconnect.apple.com${path}`,{
    method,headers:{Authorization:`Bearer ${ascToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}
async function play(path,{method='GET',body}={}){
  const response=await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}${path}`,{
    method,headers:{Authorization:`Bearer ${playToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  let data=null;if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}

const app=await asc(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected Apple bundle ID.');

const infos=await asc(`/v1/apps/${appId}/appInfos?limit=50`);
const info=(infos.data||[]).find(x=>['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW'].includes(x.attributes?.state||x.attributes?.appStoreState))??infos.data?.[0];
if(!info)throw Error('No Apple appInfo found.');
const infoLocs=await asc(`/v1/appInfos/${encodeURIComponent(info.id)}/appInfoLocalizations?limit=200`);
const infoLoc=(infoLocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!infoLoc)throw Error('Missing Apple en-US appInfo localization.');

const versions=await asc(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version=(versions.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version)throw Error('Missing Apple iOS 1.0 version.');
const state=version.attributes?.appVersionState||version.attributes?.appStoreState;
if(!['PREPARE_FOR_SUBMISSION','READY_FOR_REVIEW'].includes(state))throw Error(`Apple version not safely editable: ${state}`);
const versionLocs=await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`);
const versionLoc=(versionLocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!versionLoc)throw Error('Missing Apple en-US version localization.');

await asc(`/v1/appInfoLocalizations/${encodeURIComponent(infoLoc.id)}`,{
  method:'PATCH',body:{data:{type:'appInfoLocalizations',id:infoLoc.id,attributes:{subtitle:apple.subtitle}}},
});
await asc(`/v1/appStoreVersionLocalizations/${encodeURIComponent(versionLoc.id)}`,{
  method:'PATCH',body:{data:{type:'appStoreVersionLocalizations',id:versionLoc.id,attributes:{
    description:apple.description,promotionalText:apple.promotionalText,keywords:apple.keywords,
    marketingUrl:apple.marketingUrl,supportUrl:apple.supportUrl,
  }}},
});

let editId='';
let committed=false;
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  editId=edit.id;
  if(!editId)throw Error('Google Play edit did not return id.');
  await play(`/edits/${editId}/listings/${locale}`,{
    method:'PUT',body:google,
  });
  await play(`/edits/${editId}:commit`,{method:'POST',body:{}});
  committed=true;
  editId='';
}finally{
  if(editId&&!committed){
    try{await play(`/edits/${editId}`,{method:'DELETE'});}catch{}
  }
}

const finalInfoLoc=await asc(`/v1/appInfoLocalizations/${encodeURIComponent(infoLoc.id)}?fields%5BappInfoLocalizations%5D=locale,subtitle`);
const finalVersionLoc=await asc(`/v1/appStoreVersionLocalizations/${encodeURIComponent(versionLoc.id)}?fields%5BappStoreVersionLocalizations%5D=locale,description,promotionalText,keywords,marketingUrl,supportUrl`);

let verifyEdit='';
let finalGoogle;
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  verifyEdit=edit.id;
  finalGoogle=await play(`/edits/${verifyEdit}/listings/${locale}`);
}finally{
  if(verifyEdit)try{await play(`/edits/${verifyEdit}`,{method:'DELETE'});}catch{}
}

for(const [key,value] of Object.entries(apple)){
  const actual=key==='subtitle'?finalInfoLoc.data?.attributes?.subtitle:finalVersionLoc.data?.attributes?.[key];
  if(actual!==value)throw Error(`Apple ${key} did not settle.`);
}
for(const [key,value] of Object.entries(google)){
  if(finalGoogle?.[key]!==value)throw Error(`Google ${key} did not settle.`);
}

console.log(JSON.stringify({
  synced:true,
  apple:{subtitle:finalInfoLoc.data.attributes.subtitle,keywords:finalVersionLoc.data.attributes.keywords,
    marketingUrl:finalVersionLoc.data.attributes.marketingUrl,supportUrl:finalVersionLoc.data.attributes.supportUrl},
  google:{title:finalGoogle.title,shortDescription:finalGoogle.shortDescription,fullDescriptionChars:finalGoogle.fullDescription.length},
  reviewSubmissionCreated:false,releaseTriggered:false,trackMutation:false,
},null,2));
