// Publish an already-recorded real-site Short. Only runs on reviewed main with
// an explicit YouTube setup. Ambiguous writes retain a claimed receipt: no duplicates.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pacificDay,shortMetadata,videoFilename,youtubeReceiptMarker,checkedDay,
  INTRO_SECONDS,PACK_SECONDS,OUTRO_SECONDS,TEMPLATE_VERSION,TOTAL_FRAMES} from './daily-short.mjs';

const ROOT='https://api.github.com/repos/killjoy00/mtg-ev-analyzer';
const LEDGER=1135; // Already-owned Daily social publishing ledger; no secrets in comments.
const FETCH_TIMEOUT=35_000;
async function readJson(response,label) {
  if(!response.ok)throw Error(`${label} returned HTTP ${response.status}.`);
  return response.json();
}
async function issueApi(token,path,{method='GET',body}={}) {
  const response=await fetch(ROOT+path,{
    method,headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json',
      ...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(FETCH_TIMEOUT),
  });
  return readJson(response,'Daily video receipt ledger');
}
const receiptBody=(day,status,id='')=>youtubeReceiptMarker(day)+`status: ${status}`+
  (id?`\nyoutube_video_id: ${id}`:'')+'\nAutomated Pack One Daily YouTube receipt. No credentials or private links.';
async function existingReceipt(token,day) {
  const marker=youtubeReceiptMarker(day);
  for(let page=1;page<=20;page++) {
    const comments=await issueApi(token,`/issues/${LEDGER}/comments?since=${encodeURIComponent(day+'T00:00:00Z')}&per_page=100&page=${page}`);
    const matched=comments.find(c=>c?.user?.login==='github-actions[bot]'&&c.body?.startsWith(marker));
    if(matched)return matched;
    if(comments.length<100)return null;
  }
  throw Error('Daily video receipt history exceeded the safety limit.');
}
export async function youtubeReceipt({token,day}) {
  if(!token)throw Error('Missing GitHub receipt token.');
  checkedDay(day);
  return {
    async claim() {
      const prior=await existingReceipt(token,day);
      if(prior?.body?.includes('\nstatus: posted'))return {alreadyPosted:true};
      if(prior?.body?.includes('\nstatus: claimed'))
        throw Error('Prior YouTube upload is unconfirmed. Reconcile channel and receipt before retrying.');
      if(prior?.body?.includes('\nstatus: failed')) {
        await issueApi(token,`/issues/comments/${prior.id}`,{method:'PATCH',body:{body:receiptBody(day,'claimed')}});
        return {id:prior.id,alreadyPosted:false};
      }
      if(prior)throw Error('Daily YouTube receipt is unrecognized.');
      const created=await issueApi(token,`/issues/${LEDGER}/comments`,{method:'POST',body:{body:receiptBody(day,'claimed')}});
      return {id:created.id,alreadyPosted:false};
    },
    async markFailed(claim) {
      await issueApi(token,`/issues/comments/${claim.id}`,{method:'PATCH',body:{body:receiptBody(day,'failed')}});
    },
    async markPosted(claim,videoId) {
      if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw Error('YouTube returned invalid video ID.');
      await issueApi(token,`/issues/comments/${claim.id}`,{method:'PATCH',body:{body:receiptBody(day,'posted',videoId)}});
    },
  };
}
export async function youtubeAccessToken({clientId,clientSecret,refreshToken,fetchImpl=fetch}) {
  if(!clientId||!clientSecret||!refreshToken)throw Error('YouTube OAuth credentials are incomplete.');
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,
      refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(FETCH_TIMEOUT),
  });
  const json=await readJson(response,'YouTube OAuth refresh');
  if(typeof json.access_token!=='string'||json.access_token.length<10)
    throw Error('YouTube OAuth did not issue an access token.');
  return json.access_token;
}
export function checkedUploadLocation(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||!['www.googleapis.com','youtube.googleapis.com'].includes(url.hostname)||
     url.username||url.password||url.port||!url.pathname.startsWith('/upload/youtube/v3/videos'))
    throw Error('YouTube API returned an untrusted upload URL.');
  return url.toString();
}
export async function uploadVideo({accessToken,day,bytes,fetchImpl=fetch,metadata=null}) {
  if(!(bytes instanceof Uint8Array)||bytes.length<100_000)throw Error('Invalid or empty Daily MP4.');
  const initial=await fetchImpl('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
    method:'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json; charset=UTF-8',
      'x-upload-content-type':'video/mp4','x-upload-content-length':String(bytes.length)},
    body:JSON.stringify(metadata||shortMetadata(day)),signal:AbortSignal.timeout(FETCH_TIMEOUT),
  });
  // An HTTP refusal means YouTube created nothing, so the day can be retried.
  if(!initial.ok)throw Object.assign(Error(`YouTube upload initiation returned HTTP ${initial.status}.`),{refused:true});
  const uploadUrl=checkedUploadLocation(initial.headers.get('location'));
  // Once the bytes request starts, timeouts/errors can mean YouTube actually
  // accepted the upload; the claimed receipt intentionally blocks all retries.
  const done=await fetchImpl(uploadUrl,{
    method:'PUT',headers:{'content-type':'video/mp4','content-length':String(bytes.length)},
    body:bytes,signal:AbortSignal.timeout(150_000),
  });
  if(done.status>=400&&done.status<500)
    throw Object.assign(Error(`YouTube media upload returned HTTP ${done.status}.`),{refused:true});
  const video=await readJson(done,'YouTube media upload');
  if(!/^[A-Za-z0-9_-]{11}$/.test(video?.id||''))throw Error('YouTube upload lacks a video ID.');
  return {id:video.id,visibility:video.status?.privacyStatus||null};
}
export async function main() {
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')
    throw Error('YouTube publication is restricted to reviewed main.');
  const {PACKONE_YOUTUBE_CLIENT_ID:clientId,PACKONE_YOUTUBE_CLIENT_SECRET:clientSecret,
    PACKONE_YOUTUBE_REFRESH_TOKEN:refreshToken,GITHUB_TOKEN:githubToken}=process.env;
  const raw=JSON.parse(await readFile('artifacts/daily-short/capture.json','utf8'));
  const day=checkedDay(raw.day);
  if(raw.real_browser_capture!==true||raw.spoiler_free!==true||raw.environment!=='mixed'||
     raw.duration_seconds!==10||raw.template_version!==TEMPLATE_VERSION||
     raw.intro_seconds!==INTRO_SECONDS||raw.pack_seconds!==PACK_SECONDS||
     raw.outro_seconds!==OUTRO_SECONDS||raw.frames!==TOTAL_FRAMES||
     typeof raw.puzzle_id!=='string'||raw.cards<10)
    throw Error('YouTube publication requires a validated real-browser, spoiler-free Daily.');
  if(day!==pacificDay())throw Error('Refusing to post a previous Daily.');
  const bytes=new Uint8Array(await readFile(path.join('artifacts/daily-short',videoFilename(day))));
  const token=await youtubeAccessToken({clientId,clientSecret,refreshToken});
  const receipts=await youtubeReceipt({token:githubToken,day});
  const claim=await receipts.claim();
  if(claim.alreadyPosted){console.log(JSON.stringify({day,already_posted:true}));return;}
  // Fail-closed on any ambiguous failure, including a successful upload whose
  // receipt PATCH fails. Reconciliation is required before the next attempt.
  // Only an explicit YouTube refusal marks the receipt failed for a retry.
  let uploaded;
  try {uploaded=await uploadVideo({accessToken:token,day,bytes});}
  catch(error) {
    if(error?.refused)await receipts.markFailed(claim).catch(()=>{});
    throw error;
  }
  await receipts.markPosted(claim,uploaded.id);
  console.log(JSON.stringify({day,posted:true,video_url:`https://youtu.be/${uploaded.id}`,
    api_visibility:uploaded.visibility,requested_visibility:'public'}));
  if(uploaded.visibility && uploaded.visibility!=='public')
    console.warn('YouTube did not grant public visibility. Check API project verification and channel settings.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  main().catch(e=>{console.error(`Daily YouTube upload failed: ${e.message}`);process.exitCode=1;});
}