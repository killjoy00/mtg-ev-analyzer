import {PATREON_POLICY} from './patreon-policy.mjs';
const POST_API='https://www.patreon.com/api/oauth2/v2/';

export function safePostUrl(input,expectedId) {
 try {
  if(typeof input!=='string')return null;
  const url=new URL(input,'https://www.patreon.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||
     !['patreon.com','www.patreon.com'].includes(url.hostname))return null;
  // Patreon also returns creator-prefixed and legacy creation permalinks.
  // Bind every accepted shape to the API resource ID, then use the canonical
  // public post URL rather than exposing tracking parameters or redirects.
  const match=url.pathname.match(/^\/(?:[^/]+\/)?posts\/(?:[^/]+-)?([0-9]+)\/?$/);
  const id=match?.[1]||(url.pathname==='/creation'?url.searchParams.get('hid'):null);
  if(!/^\d+$/.test(id||'')||(expectedId!==undefined&&String(expectedId)!==id))return null;
  return 'https://www.patreon.com/posts/'+id;
 } catch {return null;}
}

// Read-only, supported API for exact-title deduplication and publish confirmation.
// A failed or incomplete search must never be interpreted as "safe to post".
export async function findPublishedPatreonPost({title,token,
 campaignId=PATREON_POLICY.campaignId,fetchImpl=fetch,includePublishedAt=false}) {
 if(!token||!/^\d+$/.test(String(campaignId)))throw Error('patreon-post-read-not-configured');
 const initial=new URL('campaigns/'+campaignId+'/posts',POST_API);
 initial.searchParams.set('fields[post]','title,is_public,published_at,url');
 initial.searchParams.set('page[count]','100');
 let next=initial.toString(),pages=0;
 const visited=new Set(),matches=[];
 while(next) {
  const url=new URL(next,POST_API);
  if(url.origin!=='https://www.patreon.com'||
     url.pathname!==initial.pathname||visited.has(url.toString())||++pages>10)
   throw Error('patreon-post-search-incomplete');
  visited.add(url.toString());
  const response=await fetchImpl(url.toString(),{
   headers:{authorization:'Bearer '+token,accept:'application/json',
    'user-agent':'Pack One featured publisher'},
   redirect:'error',signal:AbortSignal.timeout(25000),
  });
  if(!response.ok)throw Error('patreon-post-read-failed-'+response.status);
  const page=await response.json();
  if(!Array.isArray(page?.data))throw Error('patreon-post-read-malformed');
  for(const item of page.data) {
   if(item?.attributes?.title!==title)continue;
   const a=item.attributes;
   if(!a.published_at||a.is_public!==true||!safePostUrl(a.url,item.id)) {
    const error=Error('patreon-existing-post-not-verified-public');
    error.verificationReason=!a.published_at?'unpublished':
     a.is_public!==true?'not-public':'url-invalid';
    throw error;
   }
   matches.push({id:item.id,url:safePostUrl(a.url,item.id),...(includePublishedAt?{publishedAt:a.published_at,title:a.title}:{})});
  }
  if(matches.length>1)throw Error('patreon-duplicate-posts-detected');
  next=page.links?.next||null;
  const cursor=page.meta?.pagination?.cursors?.next;
  if(!next&&cursor) {
   const nextUrl=new URL(initial);
   nextUrl.searchParams.set('page[cursor]',cursor);
   next=nextUrl.toString();
  }
 }
 return matches[0]||null;
}
