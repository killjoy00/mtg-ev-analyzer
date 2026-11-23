import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const token=process.env.PLAY_ACCESS_TOKEN;
if(!token)throw Error('Read-only Google Play audit needs a publisher token.');
const app='pro.packone.app',locale='en-US';
const base='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+app;
const types=['icon','featureGraphic','tvBanner','phoneScreenshots','sevenInchScreenshots','tenInchScreenshots','tvScreenshots','wearScreenshots'];
const out='play-media-audit';
await mkdir(out,{recursive:true});
const api=async(path,method='GET',body)=>{
  const url=base+path;
  const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body,signal:AbortSignal.timeout(45000)});
  const data=await r.text();
  if(!r.ok)throw Error(method+' '+path+' returned '+r.status+': '+data.slice(0,400));
  return data?JSON.parse(data):{};
};
let edit;
try{
  edit=(await api('/edits','POST','{}')).id;
  if(!edit)throw Error('No read-only audit edit ID');
  const listing=await api('/edits/'+edit+'/listings/'+locale);
  if(listing.language!==locale||listing.title!=='Pack One: Draft Challenge')throw Error('Unexpected Play listing; refuse to audit other listings.');
  const slots={};
  for(const type of types){
    const payload=await api('/edits/'+edit+'/listings/'+locale+'/'+type);
    slots[type]=(payload.images||[]).map((x,index)=>({index,id:x.id,url:x.url,sha1:x.sha1,sha256:x.sha256}));
  }
  const result={app,locale,source:'Google Play Android Publisher edits.images.list (no commit)',createdAt:new Date().toISOString(),slots};
  await writeFile(out+'/inventory.json',JSON.stringify(result,null,2)+'\n');

  const count=Object.fromEntries(types.map(t=>[t,slots[t].length]));
  console.log('PLAY_MEDIA_INVENTORY_COUNTS '+JSON.stringify(count));
  for(const type of types){
    console.log('PLAY_MEDIA_SLOT '+JSON.stringify({type,images:slots[type]}));
  }
  const duplicateChecks=[];
  for(const x of slots.sevenInchScreenshots)
    for(const y of slots.tenInchScreenshots)
      duplicateChecks.push({sevenIndex:x.index,tenIndex:y.index,sameSha256:!!x.sha256&&x.sha256===y.sha256,sameUrl:!!x.url&&x.url===y.url,sevenId:x.id,tenId:y.id});
  console.log('CROSS_TABLET_DUPLICATES '+JSON.stringify(duplicateChecks));
  if(slots.phoneScreenshots.length!==6) console.log('WARNING: Phone screenshot count is not six; no changes will be made.');
  if(process.env.GITHUB_STEP_SUMMARY){
    const lines=['## Pack One Google Play media audit','', 'This is a **read-only** check of committed Google Play en-US media. No edit was committed.','', '| Image type | Count |', '|---|---:|', ...types.map(t=>'| '+t+' | '+slots[t].length+' |'),'', 'Cross-tablet duplicate checks: '+JSON.stringify(duplicateChecks)];
    const fs=await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
  }

  const saveRemote=async(label,item)=>{
    if(!item?.url)return;
    try{
      const r=await fetch(item.url,{signal:AbortSignal.timeout(35000)});
      if(!r.ok)throw Error('HTTP '+r.status);
      const bytes=Buffer.from(await r.arrayBuffer());
      const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const isJpg=bytes[0]===255&&bytes[1]===216;
      if(!isPng&&!isJpg)throw Error('Unexpected content type '+r.headers.get('content-type'));
      const ext=isPng?'png':'jpg';
      await writeFile(out+'/'+label+'.'+ext,bytes);
      console.log('PREVIEW_ASSET '+JSON.stringify({label,ext,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
    }catch(e){console.log('PREVIEW_DOWNLOAD_FAILED '+JSON.stringify({label,error:String(e).slice(0,300)}));}
  };
  await saveRemote('feature-live',slots.featureGraphic[0]);
  for(const type of ['sevenInchScreenshots','tenInchScreenshots'])
    for(const item of slots[type])
      await saveRemote(type+'-'+item.index,item);
}finally{
  if(edit)await api('/edits/'+edit,'DELETE').catch(e=>console.error('Could not discard read-only audit edit: '+e));
}
