import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

if(!process.argv.includes('--dev-fixtures'))throw Error('Requires an isolated fixture database.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');

const account=randomUUID();
const other=randomUUID();
const player=randomUUID();
const tag=String(Date.now());
const original='2000'+tag.slice(-10);
const first=original+'1';
const second=original+'2';
const third=original+'3';
const future=new Date(Date.now()+3600_000).toISOString();
const past=new Date(Date.now()-3600_000).toISOString();
const t1=new Date(Date.now()-120_000).toISOString();
const t2=new Date(Date.now()-60_000).toISOString();
const t3=new Date().toISOString();

async function apply(auth,status,expiry,transaction,signedAt) {
  return (await query(
    `SELECT * FROM pack1_apply_apple_subscription_state(
      $1::uuid,$1::uuid,$2,'pro.packone.app.elite.monthly','Sandbox',
      $3,$4::timestamptz,true,$5,$6::timestamptz,NULL)`,
    [auth,original,status,expiry,transaction,signedAt],
  )).rows[0];
}
async function active(provider) {
  return Number((await query(
    `SELECT count(*)::int n FROM entitlement_grants
     WHERE auth_user_id=$1::uuid AND provider=$2 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at>now())`,
    [account,provider],
  )).rows[0].n);
}

try {
  await query(
    'INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true),($4::uuid,$5,$6,true)',
    [
      account,'QA Apple IAP',`qa-apple-${tag}@example.invalid`,
      other,'QA Apple IAP Other',`qa-apple-other-${tag}@example.invalid`,
    ],
  );
  await query('INSERT INTO players(id,display_name) VALUES($1::uuid,$2)',[player,'QA Apple IAP']);
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[account,player]);
  await query(
    `INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference,expires_at)
     VALUES($1::uuid,'custom_corpus','manual','QA',now()+interval '1 day'),
       ($1::uuid,'unlimited_cube_practice','patreon','QA',now()+interval '1 day')`,
    [account],
  );

  let row=await apply(account,'active',future,first,t1);
  assert.equal(row.account_matches,'t');
  assert.equal(row.applied,'t');
  assert.equal(await active('apple-app-store'),2);
  assert.equal(await active('manual'),1);
  assert.equal(await active('patreon'),1);

  row=await apply(account,'expired',past,second,t2);
  assert.equal(row.applied,'t');
  assert.equal(await active('apple-app-store'),0);
  assert.equal(await active('manual'),1,'Apple expiry cannot revoke manual access');
  assert.equal(await active('patreon'),1,'Apple expiry cannot revoke Patreon access');

  row=await apply(account,'active',future,first,t1);
  assert.equal(row.applied,'f','older Apple event cannot roll subscription state backward');
  assert.equal(
    (await query('SELECT status FROM apple_subscription_entitlements WHERE original_transaction_id=$1',[original])).rows[0].status,
    'expired',
  );

  row=await apply(account,'grace_period',future,third,t3);
  assert.equal(row.applied,'t');
  assert.equal(await active('apple-app-store'),2,'billing grace remains entitled until its signed expiry');

  const mismatch=await apply(other,'active',future,third,new Date(Date.now()+60_000).toISOString());
  assert.equal(mismatch.account_matches,'f','subscription chain cannot move between Pack One accounts');

  console.log('Apple IAP SQL lifecycle passed: union grants, stale-event defense, expiry isolation, grace, and account binding.');
} finally {
  await query('DELETE FROM entitlement_grants WHERE auth_user_id IN ($1::uuid,$2::uuid)',[account,other]);
  await query('DELETE FROM apple_subscription_notifications WHERE original_transaction_id=$1',[original]);
  await query('DELETE FROM apple_subscription_entitlements WHERE original_transaction_id=$1',[original]);
  await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[account]);
  await query('DELETE FROM players WHERE id=$1::uuid',[player]);
  await query('DELETE FROM neon_auth."user" WHERE id IN ($1::uuid,$2::uuid)',[account,other]);
}
