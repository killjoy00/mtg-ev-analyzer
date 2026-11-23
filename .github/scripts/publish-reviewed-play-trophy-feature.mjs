import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const token=process.env.PLAY_ACCESS_TOKEN;
if(!token)throw Error('Missing Google Play publisher access token.');
const request=JSON.parse(readFileSync('.github/google-play-trophy-feature-request.json','utf8'));
if(request.operation!=='publish-reviewed-trophy-feature-graphic'||request.packageName!=='pro.packone.app'||request.language!=='en-US')throw Error('Unexpected Play publishing request.');
const jpeg=readFileSync('reviewed-play-feature/pack-one-feature-trophy-1024x500.jpg');
const hash=buf=>createHash('sha256').update(buf).digest('hex');
if(hash(jpeg)!==request.jpegSha256)throw Error('Unapproved feature JPEG bytes. Upload refused.');
const approved=JSON.parse(readFileSync('.github/pack-one-approved-six-screenshots.json','utf8'));
const phone=Object.entries(approved.sha256).filter(([k])=>k.startsWith('google-play/')).sort(([a],[b])=>a.localeCompare(b)).map(([,h])=>h);
if(phone.length!==6)throw Error('Expected six approved phone image hashes.');

const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+request.packageName;
const uploadBase='https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'+request.packageName;
const api=async(path,{method='GET',data,headers={}}={})=>{
  const target=path.startsWith('http')?path:base+path;
  const res=await fetch(target,{method,headers:{Authorization:'Bearer '+token,...headers},body:data,signal:AbortSignal.timeout(60000)});
  const raw=await res.text();
  if(!res.ok)throw Error(method+' '+path+' HTTP '+res.status+': '+raw.slice(0,700));
  return {res,body:raw?JSON.parse(raw):{}};
};
const get=async(path)=>(await api(path)).body;
const images=async(edit,type)=>(await get('/edits/'+edit+'/listings/'+request.language+'/'+type)).images||[];
const imageType=['phoneScreenshots','sevenInchScreenshots','tenInchScreenshots','icon','featureGraphic'];
const imageSlots=async(edit)=>{
  const state={};
  for(const type of imageType)state[type]=await images(edit,type);
  return state;
};
const same=(a,b)=>JSON.stringify(a.map(x=>[x.id,x.sha256]))===JSON.stringify(b.map(x=>[x.id,x.sha256]));
const protectedState=s=>{
  if(s.phoneScreenshots.length!==6||s.phoneScreenshots.map(x=>x.sha256).join('|')!==phone.join('|'))throw Error('Approved phone gallery changed or order mismatch.');
  if(s.sevenInchScreenshots.length||s.tenInchScreenshots.length)throw Error('Unexpected tablet images. No mutation permitted.');
  if(s.icon.length!==1||s.icon[0].sha256!=='e44233fe8cab56f5de4f891bc04450411122b4c592d68228dd37f486de361640')throw Error('Pack One icon changed.');
};
let edit=null,verifyEdit=null,committed=false;
try{
  edit=(await api('/edits',{method:'POST',data:'{}',headers:{'Content-Type':'application/json'}})).body.id;
  if(!edit)throw Error('No Play edit ID was returned.');
  const listing=await get('/edits/'+edit+'/listings/'+request.language);
  if(listing.title!=='Pack One: Draft Challenge'||listing.language!==request.language)throw Error('Wrong Play listing.');
  const before=await imageSlots(edit);
  protectedState(before);
  if(before.featureGraphic.length!==1||before.featureGraphic[0].id!==request.expectedCurrentImageId||before.featureGraphic[0].sha256!==request.expectedCurrentFeatureSha256){
    throw Error('Feature graphic was changed independently. Aborting rather than overwriting.');
  }
  await api('/edits/'+edit+'/listings/'+request.language+'/featureGraphic',{method:'DELETE'});

  // Known working Google Play resumable upload flow, for the approved RGB JPEG.
  const initUrl=uploadBase+'/edits/'+edit+'/listings/'+request.language+'/featureGraphic?uploadType=resumable';
  const init=await fetch(initUrl,{method:'POST',
    headers:{Authorization:'Bearer '+token,'X-Upload-Content-Type':'image/jpeg','X-Upload-Content-Length':String(jpeg.length),'Content-Length':'0'},
    body:'',signal:AbortSignal.timeout(60000)});
  const initBody=await init.text();
  if(!init.ok)throw Error('Resumable feature upload init HTTP '+init.status+': '+initBody.slice(0,500));
  const session=init.headers.get('location');
  if(!session||!session.startsWith('https://'))throw Error('Google did not supply a valid resumable upload session.');
  const response=await fetch(session,{method:'PUT',headers:{'Content-Type':'image/jpeg','Content-Length':String(jpeg.length)},body:jpeg,signal:AbortSignal.timeout(90000)});
  const uploadText=await response.text();
  if(!response.ok)throw Error('Resumable feature upload HTTP '+response.status+': '+uploadText.slice(0,600));
  const uploaded=JSON.parse(uploadText);
  if(!uploaded?.image?.id)throw Error('Uploaded feature missing image ID.');
  const changed=await imageSlots(edit);
  protectedState(changed);
  if(changed.featureGraphic.length!==1||changed.featureGraphic[0].id!==uploaded.image.id||changed.featureGraphic[0].sha256!==request.jpegSha256)throw Error('Pending feature checksum or ID mismatch.');
  for(const type of imageType.filter(x=>x!=='featureGraphic'))
    if(!same(before[type],changed[type]))throw Error('Pending unauthorized modification of '+type);

  await api('/edits/'+edit+':commit',{method:'POST',data:'{}',headers:{'Content-Type':'application/json'}});
  committed=true;
  edit=null;
  verifyEdit=(await api('/edits',{method:'POST',data:'{}',headers:{'Content-Type':'application/json'}})).body.id;
  if(!verifyEdit)throw Error('Cannot verify committed feature image.');
  const after=await imageSlots(verifyEdit);
  protectedState(after);
  if(after.featureGraphic.length!==1||after.featureGraphic[0].id!==uploaded.image.id||after.featureGraphic[0].sha256!==request.jpegSha256)throw Error('Committed feature image mismatch.');
  for(const type of imageType.filter(x=>x!=='featureGraphic'))
    if(!same(before[type],after[type]))throw Error('An unrelated asset changed: '+type);
  const listingAfter=await get('/edits/'+verifyEdit+'/listings/'+request.language);
  for(const field of ['title','shortDescription','fullDescription'])
    if(listing[field]!==listingAfter[field])throw Error('Unrelated listing text changed: '+field);
  const receipt={published:true,verified:true,packageName:request.packageName,locale:request.language,featureSha256:request.jpegSha256,phoneScreenshotsUnchanged:6,tabletScreenshotsUnchanged:0,iconUnchanged:true,listingCopyUnchanged:true,tracksAndBundlesUnchanged:true};
  console.log('PACK_ONE_FEATURE_GRAPHIC_RECEIPT '+JSON.stringify(receipt));
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Pack One Google Play feature graphic\n\nVerified the new **Real picks from trophy drafts** feature graphic after committing to Google Play en-US. Six phone screenshots, icon, tablet image slots and listing copy remain unchanged. No app release or track changes.\n');
  }
}finally{
  if(edit&&!committed)await api('/edits/'+edit,{method:'DELETE'}).catch(e=>console.error('Could not discard uncommitted edit: '+e));
  if(verifyEdit)await api('/edits/'+verifyEdit,{method:'DELETE'}).catch(e=>console.error('Could not discard verification edit: '+e));
}
