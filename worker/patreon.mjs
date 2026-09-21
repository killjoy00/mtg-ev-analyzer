import {PATREON_POLICY,validPatreonPolicy,premiumPatreonMembership,adFreePatreonMembership} from '../patreon-policy.mjs';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const PROVIDER='patreon';
const PATREON_ORIGIN='https://www.patreon.com';
const REDIRECT_URI='https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback';
const RETURN_ORIGIN='https://packone.pro/';
const USER_AGENT='Pack One - Membership Sync (https://packone.pro)';
const MEMBER_FIELDS='currently_entitled_amount_cents,patron_status,last_charge_status,is_free_trial,is_gifted';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const truthy=value=>value===true||value==='t'||value==='true'||value===1||value==='1';
const amount=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):0;};
const redirectUri=()=>String(process.env.PATREON_REDIRECT_URI||REDIRECT_URI);
const oauthConfigured=()=>Boolean(process.env.PATREON_CLIENT_ID&&process.env.PATREON_CLIENT_SECRET);
export function patreonAccountAllowed(authUserId,policy=PATREON_POLICY) {
  return policy.enabled===true || Boolean(authUserId && policy.canaryAccountHashes?.includes(createHash('sha256').update(String(authUserId)).digest('hex')));
}
const configured=()=>validPatreonPolicy()&&oauthConfigured()&&Boolean(process.env.PATREON_WEBHOOK_SECRET);

function redirect(status) {
  const url=new URL(RETURN_ORIGIN);
  url.searchParams.set('patreon',status);
  return new Response(null,{status:302,headers:{location:url.toString(),'cache-control':'no-store'}});
}

function membership(resource,userId=null) {
  if(!resource||resource.type!=='member')return null;
  const attrs=resource.attributes||{},relationships=resource.relationships||{};
  const linkedUser=relationships.user?.data?.id||userId||null;
  const tiers=Array.isArray(relationships.currently_entitled_tiers?.data)
    ? relationships.currently_entitled_tiers.data.map(row=>String(row?.id||'')).filter(Boolean)
    : [];
  return {
    memberId:String(resource.id||''),
    userId:linkedUser?String(linkedUser):null,
    campaignId:relationships.campaign?.data?.id?String(relationships.campaign.data.id):null,
    status:attrs.patron_status==null?null:String(attrs.patron_status),
    lastChargeStatus:attrs.last_charge_status==null?null:String(attrs.last_charge_status),
    entitledAmountCents:amount(attrs.currently_entitled_amount_cents),
    isFreeTrial:truthy(attrs.is_free_trial),
    isGifted:truthy(attrs.is_gifted),
    tierIds:tiers,
  };
}

// Both OAuth and scheduled reconciliation apply a snapshot and its grants in one
// SQL statement. Revision checks discard snapshots overtaken by a webhook or link.
export async function applyPatreonMembership(query,authUserId,providerUserId,member,
  {link=false,revision=null,oauthStateHash=null,observedAt=new Date().toISOString(),policy=PATREON_POLICY}={}) {
  const active=patreonAccountAllowed(authUserId,policy)&&premiumPatreonMembership(member,policy);
  const values=[authUserId,providerUserId,member?.memberId||null,member?.campaignId||null,
    member?.status||null,member?.entitledAmountCents||0,Boolean(member?.isFreeTrial),Boolean(member?.isGifted),
    JSON.stringify(member?.tierIds||[]),member?.lastChargeStatus||null,observedAt,revision,active,oauthStateHash];
  const assignments=`provider_member_id=$3,provider_campaign_id=$4,membership_status=$5,
    currently_entitled_amount_cents=$6::int,is_free_trial=$7::boolean,is_gifted=$8::boolean,
    tier_ids=$9::jsonb,last_charge_status=$10,last_synced_at=$11::timestamptz,
    sync_requested_at=NULL,sync_revision=provider_accounts.sync_revision+1,updated_at=now()`;
  const identityGuard=link?`identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE pack1_identity_attachment_allowed($1::uuid)
    ), `:'';
  const save=link?`INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id,
      provider_member_id,provider_campaign_id,membership_status,currently_entitled_amount_cents,
      is_free_trial,is_gifted,tier_ids,last_charge_status,last_synced_at)
    SELECT $1::uuid,'patreon',$2,$3,$4,$5,$6::int,$7::boolean,$8::boolean,$9::jsonb,$10,$11::timestamptz
    FROM identity_allowed
    WHERE $12::bigint IS NULL AND EXISTS(SELECT 1 FROM provider_oauth_states
      WHERE state_hash=$14 AND auth_user_id=$1::uuid AND provider='patreon' AND consumed_at IS NOT NULL AND expires_at>now())
    ON CONFLICT(auth_user_id,provider) DO UPDATE SET provider_user_id=$2,${assignments}
      WHERE provider_accounts.last_synced_at <= $11::timestamptz
    RETURNING auth_user_id`:
    `UPDATE provider_accounts SET ${assignments}
     WHERE auth_user_id=$1::uuid AND provider='patreon' AND provider_user_id=$2
       AND $14::text IS NULL AND sync_revision=$12::bigint AND last_synced_at <= $11::timestamptz RETURNING auth_user_id`;
  const result=await query(`WITH ${identityGuard}saved AS (${save}), revoked AS (
    UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now())
    WHERE auth_user_id IN(SELECT auth_user_id FROM saved) AND provider='patreon'
      AND provider_reference<>$2 AND revoked_at IS NULL
  ), grants AS (
    INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,revoked_at,expires_at)
    SELECT saved.auth_user_id,c.capability,'patreon',$2,
      CASE WHEN $13::boolean THEN NULL ELSE now() END,$11::timestamptz+interval '3 hours'
    FROM saved CROSS JOIN (VALUES ('custom_corpus'),('unlimited_cube_practice')) c(capability)
    ON CONFLICT(auth_user_id,capability,provider,provider_reference)
    DO UPDATE SET revoked_at=EXCLUDED.revoked_at,expires_at=EXCLUDED.expires_at
    RETURNING capability
  ) SELECT count(*)::int applied FROM saved`,values);
  return Number(result.rows[0]?.applied||0)===1;
}

async function patreonFetch(url,options={}) {
  const response=await fetch(url,{...options,headers:{accept:'application/json','user-agent':USER_AGENT,...options.headers},redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const detail=`Patreon request failed (${response.status}).`;
    throw Object.assign(Error(String(detail).slice(0,300)),{status:502,providerStatus:response.status});
  }
  return data;
}

async function exchangeCode(code) {
  const body=new URLSearchParams({
    code,
    grant_type:'authorization_code',
    client_id:process.env.PATREON_CLIENT_ID,
    client_secret:process.env.PATREON_CLIENT_SECRET,
    redirect_uri:redirectUri(),
  });
  return patreonFetch(`${PATREON_ORIGIN}/api/oauth2/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
}

async function identity(accessToken) {
  const url=new URL(`${PATREON_ORIGIN}/api/oauth2/v2/identity`);
  url.searchParams.set('include','memberships.campaign,memberships.currently_entitled_tiers');
  url.searchParams.set('fields[tier]','title');
  url.searchParams.set('fields[member]',MEMBER_FIELDS);
  return patreonFetch(url,{headers:{authorization:`Bearer ${accessToken}`}});
}

function rawMembershipFromIdentity(data,policy=PATREON_POLICY) {
  const userId=data?.data?.id?String(data.data.id):null;
  if(!userId)throw Error('Patreon identity response did not contain a user.');
  const candidates=(data.included||[]).filter(row=>row?.type==='member');
  const ownIds=new Set((data.data.relationships?.memberships?.data||[]).map(row=>String(row.id)));
  const matching=candidates.find(row=>ownIds.has(String(row.id))&&row.relationships?.campaign?.data?.id===policy.campaignId&&
    (!row.relationships?.user?.data?.id||row.relationships.user.data.id===userId))||null;
  return {userId,member:membership(matching,userId)};
}

async function readRaw(request,maximumBytes=262144) {
  const length=Number(request.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maximumBytes)fail('Webhook payload too large.',413);
  const reader=request.body?.getReader();if(!reader)fail('Webhook body required.',400);
  const chunks=[];let bytes=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximumBytes){await reader.cancel();fail('Webhook payload too large.',413);}chunks.push(value);}
  } finally {reader.releaseLock();}
  const output=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
}

export function verifyPatreonSignature(raw,signature,secret) {
  if(!secret||!/^[a-f0-9]{32}$/i.test(String(signature||'')))return false;
  const expected=createHmac('md5',secret).update(raw).digest('hex');
  const supplied=String(signature).toLowerCase();
  return expected.length===supplied.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
}

async function status(query,authUserId) {
  const [provider,grants]=await Promise.all([
    query(`SELECT provider_campaign_id,membership_status,last_charge_status,currently_entitled_amount_cents,is_free_trial,is_gifted,tier_ids,connected_at,last_synced_at,sync_requested_at
      FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider=$2`,[authUserId,PROVIDER]),
    query(`SELECT capability FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider=$2
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY capability`,[authUserId,PROVIDER]),
  ]);
  const row=provider.rows[0];
  return {
    ...patreonAdvertisingStatus(row),
    configured:configured()&&patreonAccountAllowed(authUserId),
    support_url:PATREON_POLICY.supportUrl,
    webhook_configured:Boolean(process.env.PATREON_WEBHOOK_SECRET),
    connected:Boolean(row),
    membership:row?{
      status:row.membership_status||null,
      entitled_amount_cents:amount(row.currently_entitled_amount_cents),
      is_free_trial:truthy(row.is_free_trial),
      is_gifted:truthy(row.is_gifted),
      tier_ids:typeof row.tier_ids==='string'?JSON.parse(row.tier_ids):row.tier_ids||[],
      connected_at:row.connected_at,
      last_synced_at:row.last_synced_at,
      sync_pending:Boolean(row.sync_requested_at),
    }:null,
    capabilities:grants.rows.map(row=>row.capability),
  };
}

export function patreonAdvertisingStatus(row,now=Date.now(),policy=PATREON_POLICY) {
  if(!row)return {ad_free:false,ads_allowed:true};
  const tiers=typeof row.tier_ids==='string'?JSON.parse(row.tier_ids):row.tier_ids||[];
  const adFree=adFreePatreonMembership({campaignId:row.provider_campaign_id,
    tierIds:tiers,status:row.membership_status,lastChargeStatus:row.last_charge_status,
    isFreeTrial:truthy(row.is_free_trial),isGifted:truthy(row.is_gifted)},policy);
  const age=now-new Date(row.last_synced_at).getTime();
  // Stale membership cannot expose a paying member to ads during a sync outage.
  const fresh=Number.isFinite(age)&&age>=0&&age<3*60*60*1000&&!row.sync_requested_at;
  return {ad_free:adFree,ads_allowed:fresh&&!adFree};
}

async function webhook(request,query,json) {
  const secret=process.env.PATREON_WEBHOOK_SECRET;
  if(!configured()||!secret)return json({error:'Patreon webhook is not configured.'},503);
  const raw=await readRaw(request);
  if(!verifyPatreonSignature(raw,request.headers.get('x-patreon-signature'),secret))return json({error:'Invalid Patreon signature.'},401);
  const event=String(request.headers.get('x-patreon-event')||'');
  if(!['members:create','members:update','members:delete'].includes(event))return json({ok:true,ignored:true});
  let payload;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid Patreon payload.'},400);}
  const member=membership(payload?.data);
  if(!member?.memberId)return json({error:'Invalid Patreon member payload.'},400);
  if(member.campaignId!==PATREON_POLICY.campaignId)return json({ok:true,ignored:true});
  // Events may be duplicated or delivered out of order. They request a fresh
  // authoritative API read; their payloads never grant or revoke access.
  const digest=createHash('sha256').update(event).update(raw).digest('hex');
  await query(`WITH receipt AS (
    INSERT INTO provider_webhook_receipts(event_key) VALUES($1)
    ON CONFLICT DO NOTHING RETURNING event_key
  ) UPDATE provider_accounts SET sync_requested_at=now(),sync_revision=sync_revision+1
    WHERE provider='patreon' AND provider_campaign_id=$2
      AND (provider_member_id=$3 OR ($4<>'' AND provider_user_id=$4))
      AND EXISTS(SELECT 1 FROM receipt)`,[digest,member.campaignId,member.memberId,member.userId||'']);
  return json({ok:true});
}

export async function handlePatreon(request,{query,authSession,json}) {
  const url=new URL(request.url);
  if(url.pathname==='/v1/patreon/webhook'&&request.method==='POST')return webhook(request,query,json);
  if(url.pathname==='/v1/patreon/callback'&&request.method==='GET') {
    if(!configured())return redirect('unavailable');
    const state=String(url.searchParams.get('state')||''),code=String(url.searchParams.get('code')||'');
    if(!/^[a-f0-9]{64}$/.test(state)||!code)return redirect('error');
    const hash=createHash('sha256').update(state).digest('hex');
    const consumed=await query(`UPDATE provider_oauth_states SET consumed_at=now() WHERE state_hash=$1 AND provider=$2 AND expires_at>now() AND consumed_at IS NULL
      RETURNING auth_user_id`,[hash,PROVIDER]);
    if(!consumed.rows[0])return redirect('expired');
    if(!patreonAccountAllowed(consumed.rows[0].auth_user_id))return redirect('unavailable');
    try {
      const observedAt=new Date().toISOString();
      const tokens=await exchangeCode(code);
      if(!tokens.access_token)throw Error('Patreon token exchange returned no access token.');
      const resolved=rawMembershipFromIdentity(await identity(tokens.access_token));
      const applied=await applyPatreonMembership(query,consumed.rows[0].auth_user_id,resolved.userId,resolved.member,{link:true,observedAt,oauthStateHash:hash});
      await query('DELETE FROM provider_oauth_states WHERE state_hash=$1',[hash]);
      if(!applied)return redirect('expired');
      return redirect('connected');
    } catch(error) {
      console.error('Patreon OAuth callback failed',Number(error.providerStatus||error.status||500));
      return redirect('error');
    }
  }
  if(!url.pathname.startsWith('/v1/patreon/'))return null;
  const auth=await authSession(request),authUserId=auth.user_id;
  if(url.pathname==='/v1/patreon/status'&&request.method==='GET')return json(await status(query,authUserId));
  if(url.pathname==='/v1/patreon/connect'&&request.method==='POST') {
    if(!configured()||!patreonAccountAllowed(authUserId))return json({error:'Patreon membership is not fully configured yet.'},503);
    const state=randomBytes(32).toString('hex'),hash=createHash('sha256').update(state).digest('hex');
    await query('DELETE FROM provider_oauth_states WHERE expires_at<=now()');
    const inserted=await query(`WITH identity_allowed AS MATERIALIZED (
      SELECT 1 WHERE pack1_identity_attachment_allowed($2::uuid)
    )
      INSERT INTO provider_oauth_states(state_hash,auth_user_id,provider,expires_at)
      SELECT $1,$2::uuid,$3,now()+interval '10 minutes' FROM identity_allowed
      RETURNING state_hash`,[hash,authUserId,PROVIDER]);
    if(!inserted.rows[0])
      throw Object.assign(Error('This account is being deleted.'),{status:409,code:'ACCOUNT_DELETING'});
    const target=new URL(`${PATREON_ORIGIN}/oauth2/authorize`);
    target.searchParams.set('response_type','code');
    target.searchParams.set('client_id',process.env.PATREON_CLIENT_ID);
    target.searchParams.set('redirect_uri',redirectUri());
    target.searchParams.set('scope','identity');
    target.searchParams.set('state',state);
    return json({url:target.toString()});
  }
  if(url.pathname==='/v1/patreon/disconnect'&&request.method==='POST') {
    await query(`WITH states AS (
      DELETE FROM provider_oauth_states WHERE auth_user_id=$1::uuid AND provider='patreon'
    ), accounts AS (
      DELETE FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon'
    ) UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now())
      WHERE auth_user_id=$1::uuid AND provider='patreon' AND revoked_at IS NULL`,[authUserId]);
    return json({ok:true});
  }
  return json({error:'Not found.'},404);
}

export {membership as parsePatreonMembership,rawMembershipFromIdentity};
