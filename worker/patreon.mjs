import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const PROVIDER='patreon';
const PATREON_ORIGIN='https://www.patreon.com';
const REDIRECT_URI='https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech/v1/patreon/callback';
const RETURN_ORIGIN='https://packone.pro/';
const USER_AGENT='Pack One - Membership Sync (https://packone.pro)';
const PAID_CAPABILITIES=['custom_corpus','unlimited_cube_practice'];
const MEMBER_FIELDS='currently_entitled_amount_cents,patron_status,last_charge_status,is_free_trial,is_gifted';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const truthy=value=>value===true||value==='t'||value==='true'||value===1||value==='1';
const amount=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):0;};
const redirectUri=()=>String(process.env.PATREON_REDIRECT_URI||REDIRECT_URI);
const configured=()=>Boolean(process.env.PATREON_CLIENT_ID&&process.env.PATREON_CLIENT_SECRET);

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
    entitledAmountCents:amount(attrs.currently_entitled_amount_cents),
    isFreeTrial:truthy(attrs.is_free_trial),
    isGifted:truthy(attrs.is_gifted),
    tierIds:tiers,
  };
}

export function paidPatreonMembership(member,{deleted=false}={}) {
  if(deleted||!member)return false;
  return member.entitledAmountCents>0||member.isFreeTrial||member.isGifted;
}

async function syncEntitlements(query,authUserId,member,active) {
  const reference=member?.memberId||member?.userId;
  if(!reference)throw Error('Patreon membership lacks a stable reference.');
  await query(`UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now())
    WHERE auth_user_id=$1::uuid AND provider=$2 AND provider_reference<>$3 AND revoked_at IS NULL`,
    [authUserId,PROVIDER,reference]);
  if(!active) {
    await query(`UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now())
      WHERE auth_user_id=$1::uuid AND provider=$2 AND revoked_at IS NULL`,[authUserId,PROVIDER]);
    return;
  }
  for(const capability of PAID_CAPABILITIES) {
    await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,revoked_at,expires_at)
      VALUES($1::uuid,$2,$3,$4,NULL,NULL)
      ON CONFLICT(auth_user_id,capability,provider,provider_reference)
      DO UPDATE SET revoked_at=NULL,expires_at=NULL`,[authUserId,capability,PROVIDER,reference]);
  }
}

async function saveProviderAccount(query,authUserId,providerUserId,member) {
  const existing=await query(`SELECT auth_user_id FROM provider_accounts
    WHERE provider=$1 AND provider_user_id=$2 AND auth_user_id<>$3::uuid LIMIT 1`,
    [PROVIDER,providerUserId,authUserId]);
  if(existing.rows[0])fail('This Patreon account is already connected to another Pack One account.',409);
  await query(`INSERT INTO provider_accounts(
      auth_user_id,provider,provider_user_id,provider_member_id,provider_campaign_id,membership_status,
      currently_entitled_amount_cents,is_free_trial,is_gifted,tier_ids,last_synced_at,updated_at)
    VALUES($1::uuid,$2,$3,$4,$5,$6,$7::int,$8::boolean,$9::boolean,$10::jsonb,now(),now())
    ON CONFLICT(auth_user_id,provider) DO UPDATE SET
      provider_user_id=EXCLUDED.provider_user_id,
      provider_member_id=EXCLUDED.provider_member_id,
      provider_campaign_id=EXCLUDED.provider_campaign_id,
      membership_status=EXCLUDED.membership_status,
      currently_entitled_amount_cents=EXCLUDED.currently_entitled_amount_cents,
      is_free_trial=EXCLUDED.is_free_trial,
      is_gifted=EXCLUDED.is_gifted,
      tier_ids=EXCLUDED.tier_ids,
      last_synced_at=now(),updated_at=now()`,
    [authUserId,PROVIDER,providerUserId,member?.memberId||null,member?.campaignId||null,member?.status||null,
      member?.entitledAmountCents||0,Boolean(member?.isFreeTrial),Boolean(member?.isGifted),JSON.stringify(member?.tierIds||[])]);
}

async function patreonFetch(url,options={}) {
  const response=await fetch(url,{...options,headers:{accept:'application/json','user-agent':USER_AGENT,...options.headers},redirect:'error',signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const detail=data?.errors?.[0]?.detail||data?.error_description||data?.error||`Patreon request failed (${response.status}).`;
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
  url.searchParams.set('include','memberships');
  url.searchParams.set('fields[member]',MEMBER_FIELDS);
  return patreonFetch(url,{headers:{authorization:`Bearer ${accessToken}`}});
}

function rawMembershipFromIdentity(data) {
  const userId=data?.data?.id?String(data.data.id):null;
  if(!userId)throw Error('Patreon identity response did not contain a user.');
  const candidates=(data.included||[]).filter(row=>row?.type==='member');
  const matching=candidates.find(row=>row.relationships?.user?.data?.id===userId)||candidates[0]||null;
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
    query(`SELECT membership_status,currently_entitled_amount_cents,is_free_trial,is_gifted,tier_ids,connected_at,last_synced_at
      FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider=$2`,[authUserId,PROVIDER]),
    query(`SELECT capability FROM entitlement_grants WHERE auth_user_id=$1::uuid AND provider=$2
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY capability`,[authUserId,PROVIDER]),
  ]);
  const row=provider.rows[0];
  return {
    configured:configured(),
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
    }:null,
    capabilities:grants.rows.map(row=>row.capability),
  };
}

async function webhook(request,query,json) {
  const secret=process.env.PATREON_WEBHOOK_SECRET;
  if(!secret)return json({error:'Patreon webhook is not configured.'},503);
  const raw=await readRaw(request);
  if(!verifyPatreonSignature(raw,request.headers.get('x-patreon-signature'),secret))return json({error:'Invalid Patreon signature.'},401);
  const event=String(request.headers.get('x-patreon-event')||'');
  if(!['members:create','members:update','members:delete'].includes(event))return json({ok:true,ignored:true});
  let payload;try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return json({error:'Invalid Patreon payload.'},400);}
  const member=membership(payload?.data);
  if(!member?.memberId)return json({error:'Invalid Patreon member payload.'},400);
  const linked=await query(`SELECT auth_user_id,provider_user_id FROM provider_accounts
    WHERE provider=$1 AND (provider_member_id=$2 OR ($3<>'' AND provider_user_id=$3)) LIMIT 1`,
    [PROVIDER,member.memberId,member.userId||'']);
  if(!linked.rows[0])return json({ok:true,unlinked:true});
  const authUserId=linked.rows[0].auth_user_id,providerUserId=member.userId||linked.rows[0].provider_user_id;
  if(event==='members:delete') {
    member.status='deleted';member.entitledAmountCents=0;member.isFreeTrial=false;member.isGifted=false;member.tierIds=[];
  }
  await saveProviderAccount(query,authUserId,providerUserId,member);
  await syncEntitlements(query,authUserId,member,paidPatreonMembership(member,{deleted:event==='members:delete'}));
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
    const consumed=await query(`DELETE FROM provider_oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at>now()
      RETURNING auth_user_id`,[hash,PROVIDER]);
    if(!consumed.rows[0])return redirect('expired');
    try {
      const tokens=await exchangeCode(code);
      if(!tokens.access_token)throw Error('Patreon token exchange returned no access token.');
      const resolved=rawMembershipFromIdentity(await identity(tokens.access_token));
      await saveProviderAccount(query,consumed.rows[0].auth_user_id,resolved.userId,resolved.member);
      const effective=resolved.member||{memberId:resolved.userId,userId:resolved.userId,entitledAmountCents:0,isFreeTrial:false,isGifted:false,tierIds:[],status:null,campaignId:null};
      await syncEntitlements(query,consumed.rows[0].auth_user_id,effective,paidPatreonMembership(effective));
      return redirect('connected');
    } catch(error) {
      console.error('Patreon OAuth callback failed',error.message);
      return redirect('error');
    }
  }
  if(!url.pathname.startsWith('/v1/patreon/'))return null;
  const auth=await authSession(request),authUserId=auth.user_id;
  if(url.pathname==='/v1/patreon/status'&&request.method==='GET')return json(await status(query,authUserId));
  if(url.pathname==='/v1/patreon/connect'&&request.method==='POST') {
    if(!configured())return json({error:'Patreon connection is not configured.'},503);
    const state=randomBytes(32).toString('hex'),hash=createHash('sha256').update(state).digest('hex');
    await query('DELETE FROM provider_oauth_states WHERE expires_at<=now()');
    await query(`INSERT INTO provider_oauth_states(state_hash,auth_user_id,provider,expires_at)
      VALUES($1,$2::uuid,$3,now()+interval '10 minutes')`,[hash,authUserId,PROVIDER]);
    const target=new URL(`${PATREON_ORIGIN}/oauth2/authorize`);
    target.searchParams.set('response_type','code');
    target.searchParams.set('client_id',process.env.PATREON_CLIENT_ID);
    target.searchParams.set('redirect_uri',redirectUri());
    target.searchParams.set('scope','identity');
    target.searchParams.set('state',state);
    return json({url:target.toString()});
  }
  if(url.pathname==='/v1/patreon/disconnect'&&request.method==='POST') {
    await query('DELETE FROM provider_oauth_states WHERE auth_user_id=$1::uuid AND provider=$2',[authUserId,PROVIDER]);
    await query('DELETE FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider=$2',[authUserId,PROVIDER]);
    await query(`UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now())
      WHERE auth_user_id=$1::uuid AND provider=$2 AND revoked_at IS NULL`,[authUserId,PROVIDER]);
    return json({ok:true});
  }
  return json({error:'Not found.'},404);
}

export {membership as parsePatreonMembership,rawMembershipFromIdentity};
