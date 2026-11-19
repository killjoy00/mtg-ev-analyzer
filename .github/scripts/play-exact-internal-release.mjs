import { readFileSync } from 'node:fs';

const token=process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName=process.env.PACKONE_ANDROID_PACKAGE?.trim()||'pro.packone.app';
const bundlePath=process.argv[2];
const expectedVersionCode=String(process.argv[3]||'').trim();

if(!token)throw Error('PLAY_ACCESS_TOKEN is required.');
if(!bundlePath)throw Error('Usage: node play-exact-internal-release.mjs /path/to/app-release.aab VERSION_CODE');
if(!/^[1-9][0-9]*$/.test(expectedVersionCode))throw Error('Expected version code must be a positive integer.');

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
try{
  const edit=await request(apiBase+'/edits',{method:'POST',body:'{}'});
  editId=edit?.id;
  if(!editId)throw Error('Google Play did not return an edit ID.');

  const uploaded=await request(
    uploadBase+'/edits/'+encodeURIComponent(editId)+'/bundles?uploadType=media',
    {method:'POST',body:readFileSync(bundlePath),contentType:'application/octet-stream'},
  );
  const versionCode=String(uploaded?.versionCode??'');
  if(!versionCode)throw Error('Google Play did not return an uploaded version code.');
  if(versionCode!==expectedVersionCode){
    throw Error('Refusing to commit unexpected uploaded versionCode '+versionCode+'; expected '+expectedVersionCode+'.');
  }

  const releaseName='Pack One internal exact '+expectedVersionCode;
  await request(apiBase+'/edits/'+encodeURIComponent(editId)+'/tracks/internal',{
    method:'PUT',
    body:JSON.stringify({
      track:'internal',
      releases:[{name:releaseName,status:'draft',versionCodes:[versionCode]}],
    }),
  });

  await request(apiBase+'/edits/'+encodeURIComponent(editId)+':commit',{method:'POST',body:'{}'});
  committed=true;

  process.stdout.write(JSON.stringify({
    packageName,
    track:'internal',
    versionCode,
    expectedVersionCode,
    releaseName,
    releaseStatus:'draft',
    committed:true,
    exactVersionVerified:true,
  }));
}finally{
  if(editId&&!committed){
    try{
      await request(apiBase+'/edits/'+encodeURIComponent(editId),{method:'DELETE'});
    }catch(cleanupError){
      console.error('Failed to delete abandoned Google Play edit '+editId+': '+cleanupError.message);
    }
  }
}
