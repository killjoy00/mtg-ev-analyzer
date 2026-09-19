import {pathToFileURL} from 'node:url';
import {PATREON_POLICY,validPatreonPolicy} from '../patreon-policy.mjs';
import {applyPatreonMembership,parsePatreonMembership} from '../worker/patreon.mjs';
import {corpusDatabase} from './neon-corpus-db.mjs';

const API='https://www.patreon.com/api/oauth2/v2/';
async function get(path) {
  const url=new URL(path,API);
  if(url.origin!=='https://www.patreon.com'||!url.pathname.startsWith('/api/oauth2/v2/'))throw Error('Unexpected Patreon pagination URL.');
  const token=process.env.PATREON_CREATOR_ACCESS_TOKEN;
  if(!token)throw Error('PATREON_CREATOR_ACCESS_TOKEN is missing.');
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`,accept:'application/json','user-agent':'Pack One membership reconciliation'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Patreon API returned ${response.status}; no membership snapshot was applied. Renew the creator access token in GitHub if authorization expired.`);
  return response.json();
}

export async function discoverPatreon() {
  const data=await get('campaigns?include=tiers&fields[campaign]=creation_name,url&fields[tier]=title,amount_cents,published,url');
  // Public campaign/tier metadata only. Never emit tokens or patron records.
  const tiers=new Map((data.included||[]).filter(x=>x.type==='tier').map(x=>[x.id,x.attributes]));
  return (data.data||[]).map(c=>({campaign_id:c.id,...c.attributes,tiers:(c.relationships?.tiers?.data||[]).map(t=>({id:t.id,...tiers.get(t.id)}))}));
}

export async function reconcilePatreon(query,{policy=PATREON_POLICY,getPage=get,now=()=>new Date().toISOString()}={}) {
  if(!validPatreonPolicy(policy))return {enabled:false,applied:0};
  const observedAt=now();
  const linked=(await query("SELECT auth_user_id,provider_user_id,sync_revision FROM provider_accounts WHERE provider='patreon' ORDER BY auth_user_id")).rows;
  const members=new Map(),seen=new Set();let pages=0;
  let path=`campaigns/${policy.campaignId}/members?include=user,campaign,currently_entitled_tiers&fields[member]=patron_status,last_charge_status,currently_entitled_amount_cents,is_free_trial,is_gifted&fields[tier]=title&page[count]=1000`;
  // Finish all pagination before applying anything. A partial response must not
  // be mistaken for a cancellation of members on a later page.
  while(path) {
    if(seen.has(path)||++pages>1000)throw Error('Invalid Patreon pagination.');seen.add(path);
    const page=await getPage(path);
    if(!Array.isArray(page.data))throw Error('Invalid Patreon member collection.');
    for(const resource of page.data) {
      const member=parsePatreonMembership(resource);
      if(!member?.userId||member.campaignId!==policy.campaignId)throw Error('Member identity or campaign missing; no snapshot applied.');
      if(members.has(member.userId))throw Error('Duplicate member identity; no snapshot applied.');
      members.set(member.userId,member);
    }
    const cursor=page.meta?.pagination?.cursors?.next;
    path=page.links?.next||null;
    if(!path&&cursor) {
      const next=new URL(`campaigns/${policy.campaignId}/members`,API);
      next.search=new URL(`campaigns/${policy.campaignId}/members?include=user,campaign,currently_entitled_tiers&fields[member]=patron_status,last_charge_status,currently_entitled_amount_cents,is_free_trial,is_gifted&fields[tier]=title&page[count]=1000`,API).search;
      next.searchParams.set('page[cursor]',cursor);path=next.toString();
    }
  }
  let applied=0;
  for(const row of linked) {
    if(await applyPatreonMembership(query,row.auth_user_id,row.provider_user_id,members.get(row.provider_user_id)||null,
      {revision:row.sync_revision,observedAt,policy}))applied++;
  }
  await query("DELETE FROM provider_webhook_receipts WHERE received_at<now()-interval '7 days'");
  await query('DELETE FROM provider_oauth_states WHERE expires_at<=now()');
  return {enabled:true,pages,linked:linked.length,applied,superseded:linked.length-applied};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const mode=process.argv[2];
  if(mode==='discover')console.log(JSON.stringify({configured_secrets:Object.fromEntries(['PATREON_CLIENT_ID','PATREON_CLIENT_SECRET','PATREON_WEBHOOK_SECRET','PATREON_CREATOR_ACCESS_TOKEN','PATREON_CREATOR_REFRESH_TOKEN'].map(k=>[k,Boolean(process.env[k])])),campaigns:await discoverPatreon()},null,2));
  else if(mode==='sync') {
    if(!validPatreonPolicy())console.log(JSON.stringify({enabled:false,reason:'Awaiting tier mapping and real membership canary.'}));
    else console.log(JSON.stringify(await reconcilePatreon(corpusDatabase(process.argv[3]))));
  } else throw Error('Use discover or sync.');
}
