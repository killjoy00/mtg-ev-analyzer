// Readiness only: never creates a post, exports cookies, or logs provider data.
import {pathToFileURL} from 'node:url';
import {PATREON_POLICY} from '../patreon-policy.mjs';
import {PATREON_BROWSERLESS_PROFILE,browserlessEndpoint,openPatreonBrowser,
 assertPatreonCreator,findPublishedPatreonPost} from './publish-featured-patreon.mjs';

export async function checkPatreonPublishing({env=process.env,fetchImpl=fetch,
 openBrowser=openPatreonBrowser,assertCreator=assertPatreonCreator}={}) {
 const token=env.PACKONE_BROWSERLESS_TOKEN;
 if(!token)throw Error('patreon-browserless-token-missing');
 if(!env.PATREON_CREATOR_ACCESS_TOKEN)throw Error('patreon-read-token-missing');
 browserlessEndpoint(token,PATREON_BROWSERLESS_PROFILE);
 const response=await fetchImpl('https://production-sfo.browserless.io/profile/'+
  PATREON_BROWSERLESS_PROFILE+'?token='+encodeURIComponent(token),{
   redirect:'error',signal:AbortSignal.timeout(15000)});
 if(response.status===404)throw Error('patreon-browser-profile-missing');
 if(!response.ok)throw Error('patreon-browser-profile-unavailable');
 const metadata=await response.json();
 if(metadata?.name!==PATREON_BROWSERLESS_PROFILE||!(metadata.cookieCount>0))
  throw Error('patreon-browser-profile-empty');
 // Verify the read token actually belongs to the intended campaign, and that
 // campaigns.posts works. A valid membership token alone is insufficient.
 const campaign=await fetchImpl('https://www.patreon.com/api/oauth2/v2/campaigns',{
  headers:{authorization:'Bearer '+env.PATREON_CREATOR_ACCESS_TOKEN,
   accept:'application/json','user-agent':'Pack One featured publisher'},
  redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!campaign.ok)throw Error('patreon-campaign-read-failed');
 const data=await campaign.json();
 if(!Array.isArray(data?.data)||!data.data.some(c=>c.id===PATREON_POLICY.campaignId))
  throw Error('patreon-read-campaign-mismatch');
 await findPublishedPatreonPost({title:'Pack One readiness probe (never published)',
  token:env.PATREON_CREATOR_ACCESS_TOKEN,fetchImpl});
 const {browser,page}=await openBrowser({browserlessToken:token,
  profile:PATREON_BROWSERLESS_PROFILE});
 try {await assertCreator(page);}
 finally {await browser.close();}
 return {ready:true};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 checkPatreonPublishing().then(()=>console.log('patreon-connection-ready'))
 .catch(error=>{
  // Raw errors may contain a token-bearing connection URL. Never print them.
  console.error(String(error.message||'').match(/^patreon-[a-z0-9-]+$/)?.[0]||
   'patreon-connection-check-failed');
  process.exitCode=1;
 });
}
