import { createPrivateKey, sign } from 'node:crypto';

const issuerId=process.env.ASC_ISSUER_ID?.trim();
const keyId=process.env.ASC_KEY_ID?.trim();
const privateKeyText=process.env.ASC_PRIVATE_KEY;
const playToken=process.env.PLAY_ACCESS_TOKEN?.trim();
if(!issuerId||!keyId||!privateKeyText)throw Error('ASC credentials are required.');
if(!playToken)throw Error('PLAY_ACCESS_TOKEN is required.');

const appId='6814318676';
const bundleId='pro.packone.app';
const packageName='pro.packone.app';
const locale='en-US';
const versionString='1.0';

const appleSubtitle='Practice real draft decisions';
const privacyPolicyUrl='https://packone.pro/privacy/';
const privacyChoicesUrl='https://packone.pro/privacy/#delete-account';
const marketingUrl='https://packone.pro/';
const supportUrl='https://packone.pro/contact/';
const applePromotionalText='Make eight picks from real trophy drafts, compare your choices with the original drafter and model-supported alternatives, and build your Pack One career.';
const appleKeywords='limited,draft,card,booster,pick,practice,strategy,leaderboard,training,trophy';
const appleDescription=`Pack One is a short Limited draft-decision game built from real trophy drafts.

Make eight picks with the original drafter's earlier cards visible. Lock each choice before you see the trophy drafter's pick and Pack One's model-supported alternatives. Matching the trophy pick earns 100 points; strong alternatives can still receive partial credit.

Three fixed Daily challenges refresh each day:
- Daily Draft Run
- Daily Powered Cube
- Daily Latest Set

Everyone gets the same decisions for each Daily, so scores are directly comparable.

Keep practicing between Dailies with regular random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity.

Your Pack One account works across web, iPhone, iPad, and Android. Sign in with Apple, Google, or email. Account deletion is available in the app.

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See https://packone.pro/terms/ for attribution and source-license details.\n\nTerms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/\nPack One Terms: https://packone.pro/terms/\nPrivacy Policy: https://packone.pro/privacy/`;

const playShort='Practice real draft decisions, compare trophy picks, and track your career.';
const playFull=`Pack One turns real trophy drafts into short, repeatable draft-decision practice.

Make eight picks with the original drafter's earlier cards visible. Lock your choice, then compare it with the trophy drafter's actual pick and Pack One's model-supported alternatives.

Three fixed Daily challenges refresh each day:
- Daily Draft Run
- Daily Powered Cube
- Daily Latest Set

Everyone gets the same Daily decisions, so scores are directly comparable.

Practice between Dailies with random runs. A free Pack One account adds leaderboard participation, career history, and cross-device continuity. Existing Elite access unlocks Powered Cube and custom-set practice.

Use the same Pack One identity on web, iPhone, and Android with Apple, Google, or email sign-in. Permanent account deletion is available in the app.

Pack One is unofficial Fan Content permitted under the Wizards Fan Content Policy and is not approved or endorsed by Wizards. Card metadata and images are sourced from Scryfall. See packone.pro/terms/ for attribution and source-license details.`;

function b64(v){return Buffer.from(v).toString('base64url');}
const now=Math.floor(Date.now()/1000);
const h=b64(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
const p=b64(JSON.stringify({iss:issuerId,aud:'appstoreconnect-v1',iat:now,exp:now+900}));
const input=`${h}.${p}`;
const sig=sign('sha256',Buffer.from(input),{key:createPrivateKey(privateKeyText),dsaEncoding:'ieee-p1363'});
const ascToken=`${input}.${sig.toString('base64url')}`;

async function asc(path,{method='GET',body}={}){
  const response=await fetch(`https://api.appstoreconnect.apple.com${path}`,{method,headers:{Authorization:`Bearer ${ascToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const text=await response.text(); let data=null; if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}
async function play(path,{method='GET',body}={}){
  const response=await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}${path}`,{method,headers:{Authorization:`Bearer ${playToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const text=await response.text(); let data=null; if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw Error(`${method} ${path} HTTP ${response.status}: ${text}`);
  return data;
}

const app=await asc(`/v1/apps/${appId}?fields%5Bapps%5D=name,bundleId,contentRightsDeclaration,isOrEverWasMadeForKids`);
if(app.data?.attributes?.bundleId!==bundleId)throw Error('Unexpected App Store bundle ID.');
if(app.data?.attributes?.contentRightsDeclaration!=='USES_THIRD_PARTY_CONTENT')throw Error('Unexpected Apple content-rights declaration.');
if(app.data?.attributes?.isOrEverWasMadeForKids!==false)throw Error('Unexpected Apple kids flag.');

const appInfos=await asc(`/v1/apps/${appId}/appInfos?limit=50`);
const appInfo=(appInfos.data||[]).find(x=>x.attributes?.state==='PREPARE_FOR_SUBMISSION')||(appInfos.data||[])[0];
if(!appInfo)throw Error('No editable appInfo found.');
const age=await asc(`/v1/appInfos/${encodeURIComponent(appInfo.id)}/ageRatingDeclaration`);
const aa=age.data?.attributes||{};
if(aa.gambling!==false||aa.gamblingSimulated!=='NONE'||aa.messagingAndChat!==false||aa.unrestrictedWebAccess!==false||aa.violenceCartoonOrFantasy!=='INFREQUENT_OR_MILD') {
  throw Error('Apple age rating no longer matches the reviewed 12+ release assumptions.');
}
const infoLocs=await asc(`/v1/appInfos/${encodeURIComponent(appInfo.id)}/appInfoLocalizations?limit=200`);
const infoLoc=(infoLocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!infoLoc)throw Error('en-US App Info localization not found.');
await asc(`/v1/appInfoLocalizations/${encodeURIComponent(infoLoc.id)}`,{method:'PATCH',body:{data:{type:'appInfoLocalizations',id:infoLoc.id,attributes:{subtitle:appleSubtitle,privacyPolicyUrl,privacyChoicesUrl}}}});

const versions=await asc(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version=(versions.data||[]).find(x=>x.attributes?.platform==='IOS'&&x.attributes?.versionString===versionString);
if(!version||version.attributes?.appVersionState!=='PREPARE_FOR_SUBMISSION')throw Error('iOS 1.0 is not editable.');
await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`,{method:'PATCH',body:{data:{type:'appStoreVersions',id:version.id,attributes:{releaseType:'MANUAL'}}}});

const versionLocs=await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`);
const versionLoc=(versionLocs.data||[]).find(x=>x.attributes?.locale===locale);
if(!versionLoc)throw Error('en-US version localization not found.');
await asc(`/v1/appStoreVersionLocalizations/${encodeURIComponent(versionLoc.id)}`,{method:'PATCH',body:{data:{type:'appStoreVersionLocalizations',id:versionLoc.id,attributes:{description:appleDescription,keywords:appleKeywords,marketingUrl,promotionalText:applePromotionalText,supportUrl}}}});

const finalInfoLoc=await asc(`/v1/appInfoLocalizations/${encodeURIComponent(infoLoc.id)}`);
const finalVersion=await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`);
const finalVersionLoc=await asc(`/v1/appStoreVersionLocalizations/${encodeURIComponent(versionLoc.id)}`);
if(finalInfoLoc.data.attributes?.subtitle!==appleSubtitle||finalInfoLoc.data.attributes?.privacyChoicesUrl!==privacyChoicesUrl)throw Error('Apple app info metadata verification failed.');
if(finalVersion.data.attributes?.releaseType!=='MANUAL')throw Error('Apple manual release setting did not persist.');
for(const [k,v] of Object.entries({description:appleDescription,keywords:appleKeywords,marketingUrl,promotionalText:applePromotionalText,supportUrl})){
  if(finalVersionLoc.data.attributes?.[k]!==v)throw Error(`Apple version metadata verification failed for ${k}.`);
}

let editId=''; let committed=false;
try{
  const edit=await play('/edits',{method:'POST',body:{}});
  editId=edit.id;
  if(!editId)throw Error('Play edit ID missing.');
  await play(`/edits/${editId}/details`,{method:'PATCH',body:{defaultLanguage:locale,contactEmail:'admin@packone.pro',contactWebsite:supportUrl}});
  await play(`/edits/${editId}/listings/${locale}`,{method:'PUT',body:{language:locale,title:'Pack One',shortDescription:playShort,fullDescription:playFull}});
  const pendingListing=await play(`/edits/${editId}/listings/${locale}`);
  const pendingDetails=await play(`/edits/${editId}/details`);
  if(pendingListing.title!=='Pack One'||pendingListing.shortDescription!==playShort||pendingListing.fullDescription!==playFull)throw Error('Pending Play listing verification failed.');
  if(pendingDetails.contactEmail!=='admin@packone.pro'||pendingDetails.contactWebsite!==supportUrl)throw Error('Pending Play details verification failed.');
  await play(`/edits/${editId}:commit`,{method:'POST',body:{}});
  committed=true; editId='';
} finally {
  if(editId&&!committed){try{await play(`/edits/${editId}`,{method:'DELETE'});}catch{}}
}

let verifyEdit='';
try{
  const e=await play('/edits',{method:'POST',body:{}}); verifyEdit=e.id;
  const listing=await play(`/edits/${verifyEdit}/listings/${locale}`);
  const details=await play(`/edits/${verifyEdit}/details`);
  if(listing.shortDescription!==playShort||listing.fullDescription!==playFull)throw Error('Committed Play listing verification failed.');
  if(details.contactEmail!=='admin@packone.pro'||details.contactWebsite!==supportUrl)throw Error('Committed Play details verification failed.');
  console.log(JSON.stringify({configured:true,apple:{releaseType:'MANUAL',subtitle:appleSubtitle,privacyChoicesUrl,versionMetadata:true,ageRatingPreserved:true},googlePlay:{title:'Pack One',shortDescription:playShort,fullDescription:true,contactEmail:'admin@packone.pro',contactWebsite:supportUrl}},null,2));
} finally {
  if(verifyEdit){try{await play(`/edits/${verifyEdit}`,{method:'DELETE'});}catch{}}
}
