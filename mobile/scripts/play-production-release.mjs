// Pack One's protected, exact-artifact Google Play Production publication.
// This code may run only in the dedicated main-only release workflow. Never
// mutate Production until the signed bundle and Data safety request are verified.
const token=process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName=process.env.PACKONE_ANDROID_PACKAGE?.trim()||'pro.packone.app';
const versionCode=String(process.argv[2]||'').trim();
if(!token)throw Error('PLAY_ACCESS_TOKEN is required.');
if(process.env.PACKONE_PRODUCTION_RELEASE_APPROVED!=='1')throw Error('Production publication needs the protected release approval flag.');
if(!/^[1-9][0-9]*$/.test(versionCode))throw Error('A valid uploaded Google Play version code is required.');
const root='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+packageName;
async function request(url,{method='GET',body}={}){
  const response=await fetch(url,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await response.text();let data=null;
  if(raw){try{data=JSON.parse(raw)}catch{data=raw}}
  if(!response.ok)throw Error(method+' '+url+' HTTP '+response.status+': '+(typeof data==='string'?data:JSON.stringify(data)));
  return data;
}
let editId=null,committed=false;
try{
  const edit=await request(root+'/edits',{method:'POST',body:{}});
  editId=String(edit?.id||'');if(!editId)throw Error('Google Play did not return edit ID.');
  const base=root+'/edits/'+encodeURIComponent(editId);
  const [tracks,bundles,countries]=await Promise.all([
    request(base+'/tracks'),request(base+'/bundles'),request(base+'/countryAvailability/production')
  ]);
  const production=(tracks?.tracks||[]).find(t=>t.track==='production');
  if(!production||!(production.releases||[]).length)throw Error('Production track is not already live; refusing a first-time public release.');
  const active=(production.releases||[]).filter(r=>r.status==='completed');
  if(!active.length)throw Error('Existing Production track has no completed release.');
  const maxLive=Math.max(...active.flatMap(r=>r.versionCodes||[]).map(Number));
  if(!Number.isSafeInteger(maxLive)||Number(versionCode)<=maxLive)throw Error('Refusing non-increasing Production version code '+versionCode+' <= '+maxLive);
  if(!(bundles?.bundles||[]).some(b=>String(b.versionCode)===versionCode))throw Error('Requested exact signed AAB is not uploaded to Google Play.');
  const countryCodes=new Set((countries?.countries||[]).map(c=>c.countryCode));
  if(!countryCodes.has('US')||!countryCodes.has('CA'))throw Error('Production does not currently include US and Canada; refusing country drift.');
  const releaseName='Pack One Android '+versionCode;
  await request(base+'/tracks/production',{method:'PUT',body:{track:'production',releases:[{name:releaseName,status:'completed',versionCodes:[versionCode]}]}});
  await request(base+':validate',{method:'POST',body:{}});
  await request(base+':commit',{method:'POST',body:{}});
  committed=true;
  // A successful edit commit is a submission, not necessarily Play review
  // completion or distribution to 100% of devices.
  process.stdout.write(JSON.stringify({packageName,track:'production',versionCode,previousVersionCode:String(maxLive),releaseStatus:'completed',committed,submittedForGooglePlayReview:true,countryCount:countryCodes.size,usAndCanadaPreserved:true}));
}finally{
  if(editId&&!committed){
    try{await request(root+'/edits/'+encodeURIComponent(editId),{method:'DELETE'});}
    catch(error){console.error('Failed to discard abandoned Google Play production edit: '+error.message);}
  }
}
