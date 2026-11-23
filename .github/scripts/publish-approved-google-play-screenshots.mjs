import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const token=process.env.PLAY_ACCESS_TOKEN;
if(!token)throw Error('Google Play credentials required');
const app='pro.packone.app';
const locale='en-US';
const root='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+app;
const uploadRoot='https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'+app;
const dir='reviewed-store-assets/google-play';
const names=readdirSync(dir).filter(s=>s.endsWith('.jpg')).sort();
const approved=JSON.parse(readFileSync('.github/pack-one-approved-six-screenshots.json','utf8'));
if(names.length!==6)throw Error('Exactly six approved Google Play images expected');
for(const name of names){
  const file=readFileSync(join(dir,name));
  const hash=createHash('sha256').update(file).digest('hex');
  if(approved.sha256['google-play/'+name]!==hash)throw Error('Unapproved screenshot bytes: '+name);
}
const request=async(path,{method='GET',data,contentType}={})=>{
  const response=await fetch(path.startsWith('http')?path:root+path,{
    method,
    headers:{Authorization:'Bearer '+token,...(contentType?{'Content-Type':contentType}:{})},
    body:data
  });
  const text=await response.text();
  if(!response.ok)throw Error(method+' '+path+' '+response.status+' '+text.slice(0,1000));
  return text?JSON.parse(text):{};
};
let edit=null,verifyEdit=null,committed=false;
try{
  edit=(await request('/edits',{method:'POST',data:'{}',contentType:'application/json'})).id;
  if(!edit)throw Error('Could not open Google Play edit');
  await request('/edits/'+edit+'/listings/'+locale+'/phoneScreenshots',{method:'DELETE'});
  const ids=[];
  for(const name of names){
    const uploaded=await request(uploadRoot+'/edits/'+edit+'/listings/'+locale+'/phoneScreenshots?uploadType=media',{
      method:'POST',data:readFileSync(join(dir,name)),contentType:'image/jpeg'
    });
    if(!uploaded?.image?.id)throw Error('Image upload missing provider ID: '+name);
    ids.push(uploaded.image.id);
  }
  const before=await request('/edits/'+edit+'/listings/'+locale+'/phoneScreenshots');
  if((before.images||[]).map(x=>x.id).join('|')!==ids.join('|'))throw Error('Uncommitted Play screenshot order mismatch');
  await request('/edits/'+edit+':commit',{method:'POST',data:'{}',contentType:'application/json'});
  committed=true;
  edit=null;
  verifyEdit=(await request('/edits',{method:'POST',data:'{}',contentType:'application/json'})).id;
  const after=await request('/edits/'+verifyEdit+'/listings/'+locale+'/phoneScreenshots');
  if((after.images||[]).map(x=>x.id).join('|')!==ids.join('|'))throw Error('Committed Play screenshot order mismatch');
  console.log(JSON.stringify({uploaded:true,verified:true,platform:'google-play',locale,phoneScreenshots:ids.length,iconsChanged:false,listingTextChanged:false,bundlesChanged:false,releaseTracksChanged:false}));
}finally{
  if(edit&&!committed)await request('/edits/'+edit,{method:'DELETE'}).catch(()=>undefined);
  if(verifyEdit)await request('/edits/'+verifyEdit,{method:'DELETE'}).catch(()=>undefined);
}
