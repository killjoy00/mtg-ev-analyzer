// Read-only Google Play production readiness probe: any temporary edit is always deleted.
// A successful validate is not proof of Console production-access approval or review.
const token=process.env.PLAY_ACCESS_TOKEN?.trim();
if(!token)throw Error('Google Play access token required');
const pkg='pro.packone.app';
const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+pkg;
let editId=null;
async function api(path,{method='GET',body}={}){
  const res=await fetch(base+path,{method,headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await res.text();let data={};if(raw){try{data=JSON.parse(raw)}catch{data={raw:raw.slice(0,700)}}}
  if(!res.ok){let err=new Error('Google Play '+method+' '+path+' HTTP '+res.status+': '+JSON.stringify(data).slice(0,1400));err.status=res.status;throw err;}
  return data;
}
async function optional(path){
  try{return {ok:true,data:await api(path)};}catch(err){return {ok:false,error:err.message};}
}
try{
  const edit=await api('/edits',{method:'POST',body:{}});
  editId=String(edit.id||'');
  if(!editId)throw Error('Google Play did not return an edit ID');
  const basePath='/edits/'+encodeURIComponent(editId);
  const [tracks,bundles,prodCountries,closedCountries]=await Promise.all([
    api(basePath+'/tracks'),api(basePath+'/bundles'),
    optional(basePath+'/countryAvailability/production'),
    optional(basePath+'/countryAvailability/production-access')
  ]);
  const overview=(tracks.tracks||[]).map(t=>({track:t.track,releases:(t.releases||[]).map(r=>({name:r.name,status:r.status,versionCodes:r.versionCodes,userFraction:r.userFraction}))}));
  const versions=(bundles.bundles||[]).map(b=>String(b.versionCode));
  const closed=(tracks.tracks||[]).find(t=>t.track==='production-access');
  const candidate=(closed?.releases||[]).flatMap(r=>r.versionCodes||[]).map(String).filter(c=>versions.includes(c)).sort((a,b)=>Number(b)-Number(a))[0];
  console.log('PLAY_PRODUCTION_READINESS_SNAPSHOT '+JSON.stringify({packageName:pkg,tracks:overview,bundleCount:versions.length,latestClosedVersionCode:candidate||null,productionCountries:prodCountries,closedCountries}));
  if(!candidate){
    console.log('PLAY_PRODUCTION_DRY_RUN '+JSON.stringify({status:'not-possible',reason:'No uploaded bundle listed in the existing closed release'}));
  }else{
    // This is an uncommitted, throwaway edit. Never commit a probe.
    try{
      await api(basePath+'/tracks/production',{method:'PUT',body:{track:'production',releases:[{name:'Pack One production readiness probe',status:'draft',versionCodes:[candidate]}]}});
      await api(basePath+':validate',{method:'POST',body:{}});
      console.log('PLAY_PRODUCTION_DRY_RUN '+JSON.stringify({status:'validated-ephemerally',versionCode:candidate,committed:false,note:'Console approval and policy checks must still be confirmed before production publication'}));
    }catch(err){
      console.log('PLAY_PRODUCTION_DRY_RUN '+JSON.stringify({status:'blocked',versionCode:candidate,committed:false,error:err.message}));
    }
  }
}finally{
  if(editId){try{await api('/edits/'+encodeURIComponent(editId),{method:'DELETE'});console.log('PLAY_PRODUCTION_EDIT_DISCARDED '+editId);}catch(err){console.error('Could not delete temporary Google Play edit: '+err.message);process.exitCode=1;}}
}
