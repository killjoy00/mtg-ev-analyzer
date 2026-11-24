// Real migration contracts on the guarded disposable local PostgreSQL fixture.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
const pool=fixturePool(),client=await pool.connect();
const q=(text,values=[])=>client.query({text,values,types:textTypes});
const first=async(...args)=>(await q(...args)).rows[0];
const week='2020-01-05',at='2020-01-06T18:00:00Z';
const title='Fixture weekly receipt',link='https://www.patreon.com/posts/999999999999';
const migration=readFileSync('migrations/0081_private_patreon_weekly_receipts.sql','utf8');
try{
 await q('BEGIN');
 await q("UPDATE results_launch SET launch_at='2019-12-01T00:00:00Z'::timestamptz WHERE singleton");
 await q("INSERT INTO patreon_weekly_runs(week_end,title,state,image_sha256,image_width,image_height) VALUES($1::date,$2,'claimed',$3,1580,7000)",[week,title,'a'.repeat(64)]);
 // Unmodified production admission must reject a past week regardless of CI clock.
 assert.equal((await first('SELECT pack1_patreon_weekly_admit($1::date,$2::jsonb) ok',[week,'[]'])).ok,'f');
 // Freeze ONLY the disposable fixture's clock and cutoff so CI can exercise
 // the full Monday path before the real launch date. Never use this SQL in production.
 await q(migration.replaceAll('clock_timestamp()', "('"+at+"'::timestamptz)").replaceAll('2026-11-30T15:33:00Z','2020-01-01T00:00:00Z'));
 const make=async()=>{
  const auth_id=randomUUID(),player=randomUUID(),name='Fixture '+player.slice(0,8);
  await q('INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt") VALUES($1::uuid,$2,$3,true,now())',[auth_id,'Isolated fixture',auth_id+'@example.invalid']);
  await q('INSERT INTO players(id,display_name,username_owned) VALUES($1::uuid,$2,true)',[player,name]);
  await q('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[auth_id,player]);
  return {auth_id,name,player};
 };
 const a=await make(),b=await make(),c=await make();
 const eligible=await first('SELECT pack1_patreon_weekly_name($1::uuid) name',[a.auth_id]);assert.equal(eligible.name,a.name);
 const placements=[a,b,c,a].map(({auth_id,name})=>({auth_id,name}));
 const admit=rows=>first('SELECT pack1_patreon_weekly_admit($1::date,$2::jsonb) ok',[week,JSON.stringify(rows)]);
 await q('INSERT INTO results_preferences(auth_user_id,exclude_publications) VALUES($1::uuid,true)',[b.auth_id]);
 assert.equal((await admit(placements)).ok,'f','opted-out name blocks the exact snapshot');
 assert.equal((await first('SELECT count(*) n FROM patreon_weekly_pending_names WHERE week_end=$1::date',[week])).n,'0');
 await q('UPDATE results_preferences SET exclude_publications=false WHERE auth_user_id=$1::uuid',[b.auth_id]);
 await q('UPDATE players SET public_identity_hidden_at=now() WHERE id=$1::uuid',[c.player]);
 assert.equal((await admit(placements)).ok,'f','hidden identity blocks the exact snapshot');
 await q('UPDATE players SET public_identity_hidden_at=NULL WHERE id=$1::uuid',[c.player]);
 assert.equal((await admit(placements)).ok,'t');
 assert.equal((await admit(placements)).ok,'f','admitted receipt cannot submit twice');
 assert.equal((await first('SELECT count(*) n FROM patreon_weekly_pending_names WHERE week_end=$1::date',[week])).n,'3');
 // Deletion after the handoff: the tombstone detaches the identity and
 // retains only the name/removal deadline for an already possible post.
 await q('SELECT * FROM pack1_begin_account_deletion($1::uuid,$2::uuid)',[b.auth_id,b.player]);
 const pending=await first('SELECT auth_user_id,deletion_requested_at FROM patreon_weekly_pending_names WHERE week_end=$1::date AND name_to_remove=$2',[week,b.name]);
 assert.equal(pending.auth_user_id,null);assert.ok(pending.deletion_requested_at);
 // A different player opts out after handoff: remove the original name.
 await q('INSERT INTO results_preferences(auth_user_id,exclude_publications) VALUES($1::uuid,true)',[c.auth_id]);
 const finish=(url=link)=>first('SELECT pack1_patreon_weekly_finish($1::date,$2,$3::timestamptz) ok',[week,url,at]);
 assert.equal((await finish()).ok,'t');
 assert.equal((await finish()).ok,'t','verified receipt reconciles idempotently');
 assert.equal((await finish('https://www.patreon.com/posts/999999999998')).ok,'f');
 const records=(await q('SELECT p.auth_user_id,p.name_to_remove,t.reason,t.requested_at,t.due_at=t.requested_at+interval \'28 days\' exact FROM results_publications p LEFT JOIN results_removal_tasks t ON p.id=t.publication_id WHERE p.link=$1',[link])).rows;
 assert.equal(records.length,3);
 assert.equal(records.find(r=>r.name_to_remove===a.name).auth_user_id,a.auth_id);
 assert.equal(records.find(r=>r.name_to_remove===a.name).reason,null);
 const deleted=records.find(r=>r.name_to_remove===b.name);
 assert.equal(deleted.auth_user_id,null);assert.equal(deleted.reason,'deletion');assert.equal(deleted.requested_at,pending.deletion_requested_at);assert.equal(deleted.exact,'t');
 const opted=records.find(r=>r.name_to_remove===c.name);
 assert.equal(opted.auth_user_id,null);assert.equal(opted.reason,'request');assert.equal(opted.exact,'t');
 assert.equal((await first('SELECT count(*) n FROM patreon_weekly_pending_names WHERE week_end=$1::date',[week])).n,'0');
 // Scoped runtime has no access to pending names or Auth email.
 await q('CREATE ROLE packone_weekly_publisher LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
 await q(readFileSync('scripts/provision-weekly-publisher-grants.sql','utf8'));
 const grants=await first("SELECT has_table_privilege('packone_weekly_publisher','patreon_weekly_pending_names','SELECT') pending,has_column_privilege('packone_weekly_publisher','neon_auth.\"user\"','email','SELECT') email,has_table_privilege('packone_weekly_publisher','scores','INSERT') score_write,has_function_privilege('packone_weekly_publisher','pack1_patreon_weekly_name(uuid)','EXECUTE') filtered_name");
 assert.deepEqual(grants,{pending:'f',email:'f',score_write:'f',filtered_name:'t'});
 console.log('PASS private Patreon receipt, opt-out, pending deletion, removal and scoped grants');
}finally{await q('ROLLBACK').catch(()=>{});client.release();await pool.end();}
