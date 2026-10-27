// Public media only. Local account data and publishing credentials never enter this feed.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {makePatreonPost,findPublishedPatreonPost} from './publish-featured-patreon.mjs';
import {pacificDay,previousPacificDay} from './featured-pick.mjs';
import {assertCurrentLivePublisher} from './post-daily-social.mjs';
import {PATREON_POLICY} from '../patreon-policy.mjs';

const REPO='killjoy00/mtg-ev-analyzer';
const BRANCH='packone-patreon-feed';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function makeDesktopFeed({feature,copy,render,cover,now=new Date()}) {
 const post=makePatreonPost({feature,copy,render,cover});
 if(post.day!==previousPacificDay(now))throw Error('desktop-feed-stale-artifact');
 const day=pacificDay(now);
 return {version:1,publication_day:day,feature_day:post.day,
  campaign_id:PATREON_POLICY.campaignId,title:post.title,body:post.body,public:true,
  image_path:day+'/featured-cover.jpg',image_sha256:sha256(cover)};
}
// A public post's title/content stays pinned for that publication day. Style
// updates apply to the next post rather than renaming or duplicating today's.
export function retainPublishedDesktopFeed(candidate,existing) {
 if(!existing?.verified_public_url||existing.publication_day!==candidate.publication_day)return candidate;
 if(existing.version!==1||existing.feature_day!==candidate.feature_day||
    existing.campaign_id!==candidate.campaign_id||existing.public!==true||
    existing.image_path!==candidate.image_path||!/^[a-f0-9]{64}$/.test(existing.image_sha256||'')||
    typeof existing.title!=='string'||!existing.title||typeof existing.body!=='string')
  throw Error('desktop-feed-published-receipt-invalid');
 return existing;
}
export async function verifyDesktopFeed(feed,{token,fetchImpl=fetch,now=new Date(),find=findPublishedPatreonPost}={}) {
 if(feed.publication_day!==pacificDay(now)||feed.feature_day!==previousPacificDay(now))
  throw Error('desktop-feed-stale-artifact');
 const found=await find({title:feed.title,token,fetchImpl});
 if(feed.verified_public_url&&!found)throw Error('desktop-feed-published-post-missing');
 // This is a supported API title/publication check. Image/body validation remains
 // the local bridge's job; do not claim an anonymous visual check here.
 return {...feed,checked_at:now.toISOString(),read_check:'ok',verified_public_url:found?.url||null};
}
export async function githubJson(path,{method='GET',body,token,fetchImpl=fetch}={}) {
 const response=await fetchImpl('https://api.github.com/repos/'+REPO+'/'+path,{
  method,headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json',
   'content-type':'application/json','user-agent':'Pack One desktop feed'},
  body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(response.status===404&&method==='GET')return null;
 if(!response.ok)throw Error('desktop-feed-github-request-failed-'+response.status);
 return response.json();
}
export async function writeDesktopFeed({feed,cover,token,fetchImpl=fetch}) {
 const api=(path,args={})=>githubJson(path,{...args,token,fetchImpl});
 const ref=await api('git/ref/heads/'+BRANCH);
 const parent=ref?.object?.sha;
 const commit=parent?await api('git/commits/'+parent):null;
 const entries=[];
 if(cover) {
  if(sha256(cover)!==feed.image_sha256)throw Error('desktop-feed-image-mismatch');
  const blob=await api('git/blobs',{method:'POST',body:{content:cover.toString('base64'),encoding:'base64'}});
  entries.push({path:feed.image_path,mode:'100644',type:'blob',sha:blob.sha});
 }
 for(const path of ['latest.json',feed.publication_day+'/post.json'])
  entries.push({path,mode:'100644',type:'blob',content:JSON.stringify(feed,null,2)+'\n'});
 const tree=await api('git/trees',{method:'POST',body:{...(commit?{base_tree:commit.tree.sha}:{}),tree:entries}});
 const next=await api('git/commits',{method:'POST',body:{message:'Update public Patreon media and publication check',
  tree:tree.sha,parents:parent?[parent]:[]}});
 if(parent) {
  // Non-forced update: racing feed writers cannot overwrite a newer receipt.
  await api('git/refs/heads/'+BRANCH,{method:'PATCH',body:{sha:next.sha,force:false}});
 } else await api('git/refs',{method:'POST',body:{ref:'refs/heads/'+BRANCH,sha:next.sha}});
}
export async function main(env=process.env) {
 await assertCurrentLivePublisher({env:{...env,MANUAL_LIVE:'true'}});
 let feed,cover;
 if(env.DESKTOP_FEED_VERIFY_ONLY==='true') {
  const record=await githubJson('contents/latest.json?ref='+BRANCH,{token:env.GITHUB_TOKEN});
  if(!record)return console.log('desktop-feed:not-ready');
  feed=JSON.parse(Buffer.from(record.content,'base64').toString());
  if(feed.publication_day!==pacificDay())return console.log('desktop-feed:waiting-for-today');
 } else {
  const {feature,copy}=JSON.parse(await readFile('artifacts/featured-pick/pick.json','utf8'));
  const render=JSON.parse(await readFile('artifacts/featured-pick/render.json','utf8'));
  cover=await readFile('artifacts/featured-pick/featured-cover.jpg');
  feed=makeDesktopFeed({feature,copy,render,cover});
  const record=await githubJson('contents/latest.json?ref='+BRANCH,{token:env.GITHUB_TOKEN});
  const existing=record?JSON.parse(Buffer.from(record.content,'base64').toString()):null;
  const retained=retainPublishedDesktopFeed(feed,existing);
  if(retained!==feed)cover=undefined;
  feed=retained;
 }
 feed=await verifyDesktopFeed(feed,{token:env.PATREON_CREATOR_ACCESS_TOKEN});
 await writeDesktopFeed({feed,cover,token:env.GITHUB_TOKEN});
 console.log(feed.verified_public_url?'desktop-feed:public-post-confirmed':'desktop-feed:ready');
}
// Public diagnostics are fixed codes only. Never print raw exceptions, provider
// payloads, URLs or credentials when this job runs in the public repository.
export function safeDesktopFeedFailure(error) {
 const message=typeof error?.message==='string'?error.message:'';
 const revision=new Map([
  ['Live Daily posting requires main.','revision-main-required'],
  ['Live Daily job re-runs are forbidden; dispatch a fresh run on current main.','revision-rerun-blocked'],
  ['Live Daily revision attestation is incomplete.','revision-attestation-incomplete'],
  ['Cannot verify live Daily publisher revision.','revision-check-unavailable'],
  ['Stale Daily publisher revision; dispatch a fresh run on current main.','revision-stale'],
 ]);
 let code=revision.get(message);
 if(!code&&/^(?:desktop-feed-(?:stale-artifact|image-mismatch|published-post-missing|published-receipt-invalid|github-request-failed-\d{3})|patreon-(?:post-read-(?:not-configured|malformed|failed-\d{3})|post-search-incomplete|existing-post-not-verified-public|duplicate-posts-detected)|invalid-featured-artifact|invalid-patreon-copy|missing-patreon-provenance)$/.test(message))code=message;
 if(!code)code='unknown';
 if(code==='patreon-existing-post-not-verified-public'&&
  ['unpublished','not-public','url-invalid'].includes(error?.verificationReason))
  code+=':'+error.verificationReason;
 return code;
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{
 console.error('desktop-feed:failed-closed:'+safeDesktopFeedFailure(error));process.exitCode=1;
});
