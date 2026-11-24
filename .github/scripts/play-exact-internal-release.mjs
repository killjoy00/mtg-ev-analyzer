import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deepEqual } from 'node:assert/strict';

const token=process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName=process.env.PACKONE_ANDROID_PACKAGE?.trim()||'pro.packone.app';
const bundlePath=process.argv[2];
const expectedVersionCode=String(process.argv[3]||'').trim();
const mode=process.argv[4];
const activate=mode==='--activate-internal';
const releaseStatus=activate?'completed':'draft';

if(!token)throw Error('PLAY_ACCESS_TOKEN is required.');
if(!bundlePath)throw Error('Usage: node play-exact-internal-release.mjs /path/to/app-release.aab VERSION_CODE');
if(!/^[1-9][0-9]*$/.test(expectedVersionCode))throw Error('Expected version code must be a positive integer.');
if(mode!==undefined&&!activate)throw Error('Unsupported Internal Testing upload mode.');

const apiBase='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+packageName;
const uploadBase='https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'+packageName;

async function request(url,{method='GET',body,contentType='application/json'}={}){
  const response=await fetch(url,{
    method,
    headers:{
      authorization:'Bearer '+token,
      ...(body===undefined?{}:{'content-type':contentType}),
    },
    body,
  });
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok){
    throw Error(method+' '+url+' failed with HTTP '+response.status+': '+(typeof data==='string'?data:JSON.stringify(data)));
  }
  return data;
}

let editId=null;
let committed=false;
let verificationEditId=null;

function trackInventory(data) {
  if(!Array.isArray(data?.tracks))throw Error('Google Play did not return the track inventory.');
  const internal=data.tracks.find(track=>track.track==='internal');
  if(!internal)throw Error('Google Play did not return the existing Internal Testing track.');
  const others=data.tracks.filter(track=>track.track!=='internal').sort((a,b)=>a.track.localeCompare(b.track));
  return {internal,others};
}

function verifyActiveInternal(inventory, before) {
  deepEqual(inventory.others,before.others,'Another Google Play track changed during Internal Testing upload.');
  const releases=inventory.internal.releases||[];
  const release=releases.find(candidate=>candidate.status==='completed'&&
    candidate.versionCodes?.length===1&&String(candidate.versionCodes[0])===expectedVersionCode);
  if(!release)throw Error('Google Play did not show the requested Internal Testing version as completed.');
}

try{
  const edit=await request(apiBase+'/edits',{method:'POST',body:'{}'});
  editId=edit?.id;
  if(!editId)throw Error('Google Play did not return an edit ID.');

  const editUrl=apiBase+'/edits/'+encodeURIComponent(editId);
  const bundle=readFileSync(bundlePath);
  let before, uploaded;
  if(activate){
    const [tracks,bundles]=await Promise.all([
      request(editUrl+'/tracks'),
      request(editUrl+'/bundles'),
    ]);
    before=trackInventory(tracks);
    if((before.internal.releases||[]).some(release=>(release.versionCodes||[]).some(code=>Number(code)>Number(expectedVersionCode)))){
      throw Error('A newer Internal Testing build exists. Refusing to replace it.');
    }
    uploaded=bundles?.bundles?.find(candidate=>String(candidate.versionCode)===expectedVersionCode);
  }
  uploaded??=await request(
    uploadBase+'/edits/'+encodeURIComponent(editId)+'/bundles?uploadType=media',
    {method:'POST',body:bundle,contentType:'application/octet-stream'},
  );
  const versionCode=String(uploaded?.versionCode??'');
  if(!versionCode)throw Error('Google Play did not return an uploaded version code.');
  if(versionCode!==expectedVersionCode){
    throw Error('Refusing to commit unexpected uploaded versionCode '+versionCode+'; expected '+expectedVersionCode+'.');
  }
  if(activate&&uploaded.sha256!==createHash('sha256').update(bundle).digest('hex')){
    throw Error('Google Play bundle digest does not match the reviewed signed AAB.');
  }

  const releaseName='Pack One internal exact '+expectedVersionCode;
  await request(apiBase+'/edits/'+encodeURIComponent(editId)+'/tracks/internal',{
    method:'PUT',
    body:JSON.stringify({
      track:'internal',
      releases:[{name:releaseName,status:releaseStatus,versionCodes:[versionCode]}],
    }),
  });

  if(activate){
    verifyActiveInternal(trackInventory(await request(editUrl+'/tracks')),before);
    await request(editUrl+':validate',{method:'POST',body:'{}'});
  }
  await request(editUrl+':commit',{method:'POST',body:'{}'});
  committed=true;

  if(activate){
    const verificationEdit=await request(apiBase+'/edits',{method:'POST',body:'{}'});
    verificationEditId=verificationEdit?.id;
    if(!verificationEditId)throw Error('Google Play did not return an edit ID for release verification.');
    const verified=await request(apiBase+'/edits/'+encodeURIComponent(verificationEditId)+'/tracks');
    verifyActiveInternal(trackInventory(verified),before);
  }

  process.stdout.write(JSON.stringify({
    packageName,
    track:'internal',
    versionCode,
    expectedVersionCode,
    releaseName,
    releaseStatus,
    committed:true,
    exactVersionVerified:true,
    ...(activate?{verifiedAfterCommit:true}:{}),
  }));
}finally{
  const editToDelete=verificationEditId??(committed?null:editId);
  if(editToDelete){
    try{
      await request(apiBase+'/edits/'+encodeURIComponent(editToDelete),{method:'DELETE'});
    }catch(cleanupError){
      console.error('Failed to delete abandoned Google Play edit '+editId+': '+cleanupError.message);
    }
  }
}
