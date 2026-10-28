// Deterministic Bluesky posts and replies. A record key is claimed exactly once:
// a retry finds the same record and stops; different content under it is an error.
// Never log session tokens or app passwords.
const XRPC='https://bsky.social/xrpc/';

async function xrpc(fetchImpl,method,{auth=null,query=null,body=null,type='application/json',label}) {
 const url=new URL(XRPC+method);
 for(const [k,v] of Object.entries(query||{}))url.searchParams.set(k,v);
 const response=await fetchImpl(url.toString(),{
  method:body==null?'GET':'POST',
  headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body!=null?{'content-type':type}:{})},
  ...(body!=null?{body:type==='application/json'?JSON.stringify(body):body}:{}),
  signal:AbortSignal.timeout(15_000),
 });
 return {response,label};
}
async function ok({response,label}) {
 if(!response.ok)throw Error(label+' returned HTTP '+response.status+'.');
 return response.json();
}

export async function blueskySession(fetchImpl,{handle,password}) {
 const session=await ok(await xrpc(fetchImpl,'com.atproto.server.createSession',
  {body:{identifier:handle,password},label:'Bluesky login'}));
 if(!session?.accessJwt||!session.did)throw Error('Bluesky login returned no session.');
 return {did:session.did,jwt:session.accessJwt};
}

// Returns {uri,cid,value} or null when the key is unused.
export async function getPost(fetchImpl,session,rkey) {
 const {response}=await xrpc(fetchImpl,'com.atproto.repo.getRecord',{auth:session.jwt,
  query:{repo:session.did,collection:'app.bsky.feed.post',rkey},label:'Bluesky record lookup'});
 if(response.status===404)return null;
 if(response.status===400) {
  const data=await response.json().catch(()=>({}));
  if(data.error==='RecordNotFound')return null;
  throw Error('Bluesky record lookup returned HTTP 400.');
 }
 if(!response.ok)throw Error('Bluesky record lookup returned HTTP '+response.status+'.');
 const found=await response.json();
 if(typeof found?.uri!=='string'||typeof found?.cid!=='string')
  throw Error('Bluesky record lookup returned no reference.');
 return found;
}

export async function uploadImage(fetchImpl,session,{bytes,type}) {
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.byteLength>1_000_000)
  throw Error('Bluesky image must be between 1 byte and 1MB.');
 const result=await ok(await xrpc(fetchImpl,'com.atproto.repo.uploadBlob',
  {auth:session.jwt,body:bytes,type,label:'Bluesky image upload'}));
 if(!result?.blob)throw Error('Bluesky upload returned no blob.');
 return result.blob;
}

// Creates app.bsky.feed.post at rkey unless that exact text is already there.
// `record` must not include createdAt; it is stamped on the first write only.
export async function publishPost(fetchImpl,session,{rkey,record,prepare=null}) {
 const existing=await getPost(fetchImpl,session,rkey);
 const same=found=>{
  if(found.value?.text!==record.text)
   throw Error('The deterministic Bluesky record key is occupied by a different post.');
  return {status:'already-posted',uri:found.uri,cid:found.cid};
 };
 if(existing)return same(existing);
 // Uploads happen only once the key is known to be free.
 const extra=prepare?await prepare():{};
 const full={$type:'app.bsky.feed.post',...record,...extra,createdAt:new Date().toISOString()};
 const {response}=await xrpc(fetchImpl,'com.atproto.repo.createRecord',{auth:session.jwt,
  body:{repo:session.did,collection:'app.bsky.feed.post',rkey,record:full},label:'Bluesky publish'});
 // A PDS reports an occupied rkey as HTTP 400. Never treat an arbitrary 400 as
 // a duplicate: re-read and compare the exact content.
 if(response.status===400||response.status===409) {
  const now=await getPost(fetchImpl,session,rkey);
  if(now)return same(now);
 }
 if(!response.ok)throw Error('Bluesky publish returned HTTP '+response.status+'.');
 const created=await response.json();
 if(typeof created?.uri!=='string'||typeof created?.cid!=='string')
  throw Error('Bluesky publish returned no reference.');
 return {status:'posted',uri:created.uri,cid:created.cid};
}

// Public, unauthenticated engagement counts. Bluesky exposes no reach or impressions.
export async function publicPostCounts(fetchImpl,uris) {
 if(!uris.length)return [];
 const url=new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts');
 for(const uri of uris.slice(0,25))url.searchParams.append('uris',uri);
 const response=await fetchImpl(url.toString(),{signal:AbortSignal.timeout(15_000)});
 if(!response.ok)throw Error('Bluesky public post lookup returned HTTP '+response.status+'.');
 const {posts=[]}=await response.json();
 return posts.map(p=>({uri:p.uri,likes:p.likeCount??0,reposts:p.repostCount??0,
  replies:p.replyCount??0,quotes:p.quoteCount??0}));
}
