// The webhook route had no end-to-end coverage. patreon.test.mjs checks
// verifyPatreonSignature as a pure function, and patreon-backend-smoke.mjs
// checks applyPatreonMembership - the authoritative read that runs *after* a
// webhook - but nothing exercised POST /v1/patreon/webhook itself. So the
// three events Patreon actually sends, the signature gate in front of them,
// the campaign filter, and the replay dedupe were all untested against a real
// database. This runs the deployed handler on an isolated fixture branch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHmac, createHash} from 'node:crypto';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

// configured() reads these at call time and the route is 503 without them.
// Fixed test values keep the run hermetic even where real secrets exist.
const SECRET='webhook-backend-smoke-signing-secret';
process.env.PATREON_CLIENT_ID='webhook-backend-smoke-client';
process.env.PATREON_CLIENT_SECRET='webhook-backend-smoke-secret';
process.env.PATREON_WEBHOOK_SECRET=SECRET;

const {query, default:growth}=await import('../worker/growth-function.js');
const {PATREON_POLICY}=await import('../patreon-policy.mjs');

const user=crypto.randomUUID();
const memberId=`member-${user}`;
const providerUserId=`provider-${user}`;
const delivered=[];

function payload(campaignId=PATREON_POLICY.campaignId, status='active_patron') {
  return {data:{
    type:'member', id:memberId,
    attributes:{patron_status:status, last_charge_status:'Paid', currently_entitled_amount_cents:500},
    relationships:{
      user:{data:{id:providerUserId}},
      campaign:{data:{id:campaignId}},
      currently_entitled_tiers:{data:[{id:PATREON_POLICY.premiumTierIds[0]}]},
    },
  }};
}

// signature: omitted signs correctly; null sends no header; a string is sent as given.
async function deliver(event, body, {signature}={}) {
  const raw=Buffer.from(JSON.stringify(body));
  const sent=signature===undefined?createHmac('md5',SECRET).update(raw).digest('hex'):signature;
  const headers={'content-type':'application/json','x-patreon-event':event};
  if(sent!==null)headers['x-patreon-signature']=sent;
  const response=await growth.fetch(new Request('https://packone.pro/v1/patreon/webhook',{method:'POST',headers,body:raw}));
  const digest=createHash('sha256').update(event).update(raw).digest('hex');
  delivered.push(digest);
  return {status:response.status, body:await response.json().catch(()=>null), digest};
}

const account=async()=>(await query(
  "SELECT sync_revision,sync_requested_at FROM provider_accounts WHERE auth_user_id=$1::uuid AND provider='patreon'",
  [user])).rows[0];
const receipts=async digest=>Number((await query(
  'SELECT count(*)::int n FROM provider_webhook_receipts WHERE event_key=$1',[digest])).rows[0].n);

try {
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,\'QA Patreon Webhook\',$2,true)',
    [user,`qa-patreon-webhook-${user}@example.invalid`]);
  await query(`INSERT INTO provider_accounts(auth_user_id,provider,provider_user_id,provider_member_id,
    provider_campaign_id,membership_status,tier_ids,sync_requested_at,sync_revision)
    VALUES($1::uuid,'patreon',$2,$3,$4,'active_patron',$5::jsonb,NULL,0)`,
    [user,providerUserId,memberId,PATREON_POLICY.campaignId,JSON.stringify(PATREON_POLICY.premiumTierIds)]);

  // Each of the three events Patreon sends requests a fresh authoritative read.
  let previous=Number((await account()).sync_revision);
  for(const event of ['members:create','members:update','members:delete']) {
    // A distinct body per event keeps each delivery its own dedupe key.
    const result=await deliver(event,{...payload(),meta:{event}});
    assert.equal(result.status,200,`${event} was rejected`);
    assert.deepEqual(result.body,{ok:true},`${event} did not acknowledge`);
    assert.equal(await receipts(result.digest),1,`${event} recorded no receipt`);
    const row=await account();
    assert.ok(row.sync_requested_at,`${event} did not request a sync`);
    assert.equal(Number(row.sync_revision),previous+1,`${event} did not advance the revision`);
    previous=Number(row.sync_revision);

    // Patreon retries, so the same delivery must be idempotent.
    const replay=await deliver(event,{...payload(),meta:{event}});
    assert.equal(replay.status,200,`${event} replay was rejected`);
    assert.equal(replay.digest,result.digest,'replay must produce the same dedupe key');
    assert.equal(await receipts(replay.digest),1,`${event} replay duplicated its receipt`);
    assert.equal(Number((await account()).sync_revision),previous,`${event} replay advanced the revision twice`);
  }

  // An event type outside the three is acknowledged and otherwise ignored.
  const other=await deliver('posts:publish',payload());
  assert.equal(other.status,200);
  assert.deepEqual(other.body,{ok:true,ignored:true},'unhandled event was not ignored');
  assert.equal(await receipts(other.digest),0,'unhandled event recorded a receipt');

  // Another creator's campaign must never touch this campaign's accounts.
  const foreign=await deliver('members:update',payload('999999999'));
  assert.equal(foreign.status,200);
  assert.deepEqual(foreign.body,{ok:true,ignored:true},'foreign campaign was not ignored');
  assert.equal(await receipts(foreign.digest),0,'foreign campaign recorded a receipt');
  assert.equal(Number((await account()).sync_revision),previous,'foreign campaign advanced the revision');

  // The signature gate, on the same path that just accepted real deliveries.
  for(const [label,signature] of [
    ['a missing signature',null],
    ['a malformed signature','not-a-hex-digest'],
    ['a wrong signature','00112233445566778899aabbccddeeff'],
    ['another secret\'s signature',createHmac('md5','a different secret').update(Buffer.from(JSON.stringify(payload()))).digest('hex')],
  ]) {
    const rejected=await deliver('members:update',payload(),{signature});
    assert.equal(rejected.status,401,`${label} was accepted`);
    assert.equal(await receipts(rejected.digest),0,`${label} recorded a receipt`);
  }
  assert.equal(Number((await account()).sync_revision),previous,'a rejected delivery advanced the revision');

  // A body that does not match its signature is a tampered replay.
  const raw=Buffer.from(JSON.stringify(payload()));
  const stale=createHmac('md5',SECRET).update(raw).digest('hex');
  const tampered=await deliver('members:update',{...payload(),injected:true},{signature:stale});
  assert.equal(tampered.status,401,'a tampered body was accepted');
  assert.equal(await receipts(tampered.digest),0,'a tampered body recorded a receipt');

  console.log('Patreon webhook passed: members create/update/delete accepted and deduplicated, '
    + 'unhandled events and foreign campaigns ignored, missing/malformed/wrong/foreign-secret '
    + 'signatures and tampered bodies rejected without side effects.');
} finally {
  // The query helper sends parameters as text, so an array has to travel as
  // jsonb rather than a Postgres array literal.
  if(delivered.length)await query(
    'DELETE FROM provider_webhook_receipts WHERE event_key IN (SELECT jsonb_array_elements_text($1::jsonb))',
    [JSON.stringify([...new Set(delivered)])]);
  await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[user]);
}
