// One-day corrective reissue. Only remove records with the exact known bad
// identity; do not ever delete the ordinary Daily post or unrelated content.
import {featuredBlueskyRkey} from './featured-pick.mjs';

export const CORRECTION_DAY='2026-10-24';
export const CORRECTED_PUZZLE='f13bcd75621cd97348a3d85a75aaec91';
export const INCORRECT_PUZZLE='6893a480705900e2716ef9532387fae3';
export const OLD_VIDEO_ID='d1COWi1TOq4';
export function isCorrection(f) {
 return f?.day===CORRECTION_DAY && f.puzzle_id===CORRECTED_PUZZLE &&
  f.tier===3 && f.choices?.some(c=>c.id===f.trophy?.id);
}
export function isRetractableOldBlueskyPost(text) {
 return typeof text==='string' &&
  text.includes("Yesterday's Pack One Latest Set P1P7") &&
  text.includes('Silence the Echo') &&
  text.includes('Twinned Vision') &&
  text.includes('Murmuring Volume') &&
  text.includes('Fblthp, Knows the Way');
}
async function data(resp,label) {
 if(!resp.ok)throw Error(label+' HTTP '+resp.status);
 return resp.json();
}
export async function retractIncorrectBluesky({handle,password,newText,fetcher=fetch}={}) {
 if(!handle||!password)throw Error('Bluesky credentials are unavailable');
 const session=await data(await fetcher('https://bsky.social/xrpc/com.atproto.server.createSession',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({identifier:handle,password}),
  signal:AbortSignal.timeout(15000)}),'Bluesky auth');
 if(!session.did||!session.accessJwt)throw Error('Bluesky session missing identity');
 const headers={authorization:'Bearer '+session.accessJwt};
 const key=featuredBlueskyRkey(CORRECTION_DAY);
 const get=new URL('https://bsky.social/xrpc/com.atproto.repo.getRecord');
 get.searchParams.set('repo',session.did);
 get.searchParams.set('collection','app.bsky.feed.post');
 get.searchParams.set('rkey',key);
 const response=await fetcher(get.toString(),{headers,signal:AbortSignal.timeout(15000)});
 if(response.status===404)return 'already-absent';
 if(response.status===400) {
  const body=await response.json().catch(()=>({}));
  if(body.error==='RecordNotFound')return 'already-absent';
  throw Error('Bluesky lookup declined');
 }
 const original=await data(response,'Bluesky original lookup');
 if(original.value?.text===newText)return 'already-corrected';
 if(!isRetractableOldBlueskyPost(original.value?.text))
  throw Error('Bluesky record does not match known invalid featured post');
 const deleted=await fetcher('https://bsky.social/xrpc/com.atproto.repo.deleteRecord',{
  method:'POST',headers:{...headers,'content-type':'application/json'},
  body:JSON.stringify({repo:session.did,collection:'app.bsky.feed.post',rkey:key}),
  signal:AbortSignal.timeout(15000)});
 if(!deleted.ok)throw Error('Bluesky invalid-post removal HTTP '+deleted.status);
 const check=await fetcher(get.toString(),{headers,signal:AbortSignal.timeout(15000)});
 if(check.status!==404&&check.status!==400)
  throw Error('Bluesky invalid-post removal could not be verified');
 return 'removed-verified';
}
export async function attemptIncorrectYoutubeDeletion({token,fetcher=fetch}={}) {
 if(!token)return 'missing-auth';
 const response=await fetcher('https://www.googleapis.com/youtube/v3/videos?id='+OLD_VIDEO_ID,{
  method:'DELETE',headers:{authorization:'Bearer '+token},
  signal:AbortSignal.timeout(15000)});
 if(response.status===204)return 'removed';
 if(response.status===404)return 'already-absent';
 if(response.status===401||response.status===403)return 'requires-delete-scope';
 return 'delete-failed-http-'+response.status;
}
