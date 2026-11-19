import {buildCampaignDraft} from '../campaign-links.mjs';
import {accountSession,requireTrustedOrigin} from './account-session.mjs';

const DISPATCH_URL='https://api.github.com/repos/killjoy00/mtg-ev-analyzer/actions/workflows/campaign-link-publish.yml/dispatches';
const TOKEN_PATTERN=/^github_pat_[A-Za-z0-9_]{20,}$/;
const ALLOWED_FIELDS=new Set(['slug','destination','source','campaign','medium']);

function fail(message,status=400,code=null) {
  throw Object.assign(Error(message),{status,...(code?{code}:{})});
}

function publishToken(env) {
  const value=String(env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||'');
  if(!TOKEN_PATTERN.test(value))
    fail('Campaign publishing is temporarily unavailable.',503,'CAMPAIGN_PUBLISH_UNAVAILABLE');
  return value;
}

export function campaignLinkPublishConfigured(env=process.env) {
  return TOKEN_PATTERN.test(String(env.PACK1_LAUNCH_WATCHER_GITHUB_TOKEN||''));
}

export function normalizeCampaignPublishPayload(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))
    fail('Campaign link details are required.',400,'CAMPAIGN_LINK_INVALID');
  const unknown=Object.keys(payload).filter(key=>!ALLOWED_FIELDS.has(key));
  if(unknown.length)
    fail('Campaign link contains unsupported fields.',400,'CAMPAIGN_LINK_INVALID');
  const draft=buildCampaignDraft(payload);
  if(!draft.valid||!draft.entry)
    fail('Fix the campaign link fields before publishing.',400,'CAMPAIGN_LINK_INVALID');
  return {entry:draft.entry,trackedUrl:draft.trackedUrl,vanityUrl:draft.vanityUrl};
}

export async function dispatchCampaignLinkPublish(entry,{env=process.env,fetcher=fetch}={}) {
  let response;
  try {
    response=await fetcher(DISPATCH_URL,{
      method:'POST',
      headers:{
        authorization:'Bearer '+publishToken(env),
        accept:'application/vnd.github+json',
        'content-type':'application/json',
        'x-github-api-version':'2022-11-28',
        'user-agent':'pack1-admin-campaign-publisher',
      },
      body:JSON.stringify({
        ref:'main',
        inputs:{
          slug:entry.slug,
          destination:entry.destination,
          source:entry.source,
          campaign:entry.campaign,
          medium:entry.medium||'',
        },
      }),
      redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
  } catch(error) {
    if(error?.status)throw error;
    fail('Campaign publish request could not reach GitHub.',503,'CAMPAIGN_PUBLISH_DISPATCH');
  }
  if(![200,204].includes(response.status))
    fail('Campaign publish request was rejected.',503,'CAMPAIGN_PUBLISH_DISPATCH');
}

async function requireCampaignAdmin(request,{query,allowedOrigins}) {
  requireTrustedOrigin(request,allowedOrigins);
  const auth=await accountSession(request,query,{required:true,allowLegacy:false,csrf:true});
  const admin=await query('SELECT 1 FROM pack1_admins WHERE auth_user_id=$1::uuid LIMIT 1',[auth.user_id]);
  if(!admin.rows[0])fail('Admin access required.',403,'ADMIN_REQUIRED');
  return auth;
}

export async function handleCampaignLinkPublish(request,{query,readJson,allowedOrigins,env=process.env,fetcher=fetch}={}) {
  if(request.method!=='POST')fail('Not found.',404);
  if(typeof query!=='function'||typeof readJson!=='function'||!(allowedOrigins instanceof Set))
    throw Error('Campaign publisher dependencies are unavailable.');
  await requireCampaignAdmin(request,{query,allowedOrigins});
  const {entry,trackedUrl,vanityUrl}=normalizeCampaignPublishPayload(await readJson(request));
  await dispatchCampaignLinkPublish(entry,{env,fetcher});
  return new Response(JSON.stringify({
    ok:true,
    status:'queued',
    slug:entry.slug,
    tracked_url:trackedUrl,
    vanity_url:vanityUrl,
  }),{
    status:202,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
  });
}
