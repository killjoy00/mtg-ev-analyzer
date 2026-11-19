// One-off owner-approved publication of the 27-second RFA Short.
// Reuses existing YouTube OAuth; issue #1263 is the idempotency receipt.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {youtubeAccessToken,checkedUploadLocation} from './upload-daily-short.mjs';

const REPO='killjoy00/mtg-ev-analyzer',ISSUE=1263;
const VIDEO='artifacts/rfa-launch-short/pack-one-rfa-youtube-short-vertical.mp4';
const SHA256='bf645cd99c8a2bc1e4fd75558e085ea5641ef1bb37c5ff264ce6a90d32123e68', SIZE=1680551;
const MARKER='<!-- packone-rfa-youtube-short-2026-10-20-v1 -->';
const TITLE='What Would You Take? Real Reality Fracture Trophy Draft | Pack One #Shorts';
const DESCRIPTION=[
  'Think you can beat my 67/100 Reality Fracture score? Try the same eight decisions:',
  'https://packone.pro/creator/realityfracture/','',
  'What would you take from this real Magic: The Gathering Reality Fracture trophy draft pack?','',
  'I built Pack One, a daily MTG drafting game featuring eight picks from eight separate real trophy drafts. Make your choices, compare them to the original trophy drafters, and share your score.','',
  "This Short shows real RFA cards and packs, but doesn't reveal the trophy picks. Try the challenge before you peek!",'',
  'Pack One: https://packone.pro','',
  'Magic: The Gathering and card art are properties of Wizards of the Coast. Pack One is an independent fan-made project and is not affiliated with or endorsed by Wizards of the Coast.','',
  '#MTG #MTGLimited #MTGDraft #RealityFracture #Shorts',
].join('\n');
function assert(ok,message){if(!ok)throw Error(message);}
async function gh(token,route,{method='GET',body}={}){
  const response=await fetch('https://api.github.com/repos/'+REPO+route,{
    method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(35000),
  });
  if(!response.ok)throw Error('GitHub receipt '+method+' '+route+' HTTP '+response.status);
  return response.json();
}
function receiptText(status,id='',visibility=''){
  return MARKER+'\nstatus: '+status+(id?'\nyoutube_video_id: '+id:'')+
    (visibility?'\napi_visibility: '+visibility:'')+
    '\nVideo source sha256: '+SHA256+'\nOne-time owner-approved 27-second 9:16 Short.\n';
}
async function priorReceipt(token){
  for(let page=1;page<=15;page++){
    const arr=await gh(token,'/issues/'+ISSUE+'/comments?per_page=100&page='+page);
    const found=arr.find(x=>x.user?.login==='github-actions[bot]'&&x.body?.startsWith(MARKER));
    if(found)return found;
    if(arr.length<100)return null;
  }
  throw Error('Receipt history exceeded safe pagination.');
}
async function upload(access,bytes){
  const metadata={
    snippet:{title:TITLE,description:DESCRIPTION,categoryId:'20',defaultLanguage:'en',
      tags:['Magic the Gathering','MTG Draft','MTG Limited','Reality Fracture','Pack One','MTG','Shorts']},
    status:{privacyStatus:'public',selfDeclaredMadeForKids:false},
  };
  const initiated=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
    method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json; charset=UTF-8',
      'X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(bytes.length)},
    body:JSON.stringify(metadata),signal:AbortSignal.timeout(35000),
  });
  if(!initiated.ok)throw Object.assign(Error('YouTube upload initiation refused: HTTP '+initiated.status),{refused:true});
  const location=checkedUploadLocation(initiated.headers.get('location')||'');
  // Any ambiguous failure after this PUT must never be blindly retried.
  const done=await fetch(location,{method:'PUT',
    headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length)},
    body:bytes,signal:AbortSignal.timeout(150000)});
  if(done.status>=400&&done.status<500)
    throw Object.assign(Error('YouTube rejected video bytes: HTTP '+done.status),{refused:true});
  if(!done.ok)throw Error('Ambiguous YouTube upload completion: HTTP '+done.status);
  const video=await done.json();
  assert(/^[A-Za-z0-9_-]{11}$/.test(video?.id||''),'YouTube ID missing; inspect channel before retry');
  return {id:video.id,visibility:video.status?.privacyStatus||'unknown'};
}
export async function main(){
  assert(process.env.GITHUB_REF==='refs/heads/main'&&process.env.GITHUB_REPOSITORY===REPO,
    'Only the reviewed main branch can publish.');
  const token=process.env.GITHUB_TOKEN;
  assert(token,'Missing GitHub token for upload receipt.');
  const bytes=new Uint8Array(await readFile(VIDEO));
  assert(bytes.length===SIZE,'Video size changed.');
  assert(createHash('sha256').update(bytes).digest('hex')===SHA256,'Video hash mismatch.');
  const prior=await priorReceipt(token);
  if(prior?.body?.includes('\nstatus: posted')){
    console.log(JSON.stringify({already_posted:true,receipt:prior.html_url}));return;
  }
  if(prior)throw Error('An earlier upload was claimed/failed. Reconcile in YouTube Studio before retry. '+prior.html_url);
  // Refreshed access must work before claiming, so credential errors cannot block retries.
  const access=await youtubeAccessToken({
    clientId:process.env.PACKONE_YOUTUBE_CLIENT_ID,
    clientSecret:process.env.PACKONE_YOUTUBE_CLIENT_SECRET,
    refreshToken:process.env.PACKONE_YOUTUBE_REFRESH_TOKEN,
  });
  const receipt=await gh(token,'/issues/'+ISSUE+'/comments',{method:'POST',body:{body:receiptText('claimed')}});
  let posted;
  try{posted=await upload(access,bytes);}
  catch(error){
    if(error.refused)await gh(token,'/issues/comments/'+receipt.id,
      {method:'PATCH',body:{body:receiptText('failed')}}).catch(()=>{});
    throw error;
  }
  await gh(token,'/issues/comments/'+receipt.id,{method:'PATCH',
    body:{body:receiptText('posted',posted.id,posted.visibility)}});
  console.log(JSON.stringify({posted:true,url:'https://www.youtube.com/shorts/'+posted.id,
    api_visibility:posted.visibility,requested_visibility:'public',receipt:receipt.html_url}));
  if(posted.visibility!=='public')console.warn('Upload succeeded but public visibility was not granted.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])
  main().catch(e=>{console.error('RFA Short publication: '+e.message);process.exitCode=1;});
