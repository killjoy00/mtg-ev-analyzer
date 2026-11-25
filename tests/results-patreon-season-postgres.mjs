// Real isolated PostgreSQL season contract. Never run on a live database.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixturePool,textTypes} from './support/postgres-fixture.mjs';
const pool=fixturePool(),client=await pool.connect();
const q=(text,values=[])=>client.query({text,values,types:textTypes});
const first=async(...args)=>(await q(...args)).rows[0];
const migration=readFileSync('migrations/0083_private_patreon_season_receipts.sql','utf8');
const at='2030-01-15T18:00:00Z',day='2030-01-15',old='season-fixture-'+randomUUID(),next='season-fixture-'+randomUUID();
const key='pack-one-season:results:'+old,guideKey='pack-one-season:guide:'+next,hash='a'.repeat(64),link='https://www.patreon.com/posts/999999999997';
try{
 await q('BEGIN');
 // Fixture calendar is isolated inside rollback. Keep old product rows intact.
 await q("UPDATE draft_run_seasons SET end_date=start_date WHERE end_date IS NULL");
 await q('INSERT INTO draft_run_seasons(id,set_id,set_name,set_release_date,start_date,end_date,established_by_day) VALUES($1,$1,$2,$3,$3,$4,$3),($5,$5,$6,$7,$7,NULL,$7)',[old,'Fixture old','2029-12-01','2030-01-14',next,'Fixture next',day]);
 await q('UPDATE draft_run_season_reconciliation_state SET last_reconciled_day=$1 WHERE singleton',[day]);
 await q("UPDATE results_launch SET launch_at='2020-01-01T00:00:00Z' WHERE singleton");
 const claim=async(k,kind,sid,milestone)=>q("INSERT INTO patreon_season_runs(post_key,kind,season_id,milestone,evidence_sha256,title,body,state,image_sha256,image_width,image_height,snapshot_ticket_sha256) VALUES($1,$2,$3,$4,$5,'Fixture post','Fixture body','claimed',$5,960,4000,$5)",[k,kind,sid,milestone,hash]);
 await claim(key,'season-results',old,day);
 const admit=(k,rows)=>first('SELECT pack1_patreon_season_admit($1,$2::jsonb) ok',[k,JSON.stringify(rows)]);
 assert.equal((await admit(key,[])).ok,'f','default-disabled and wrong date');
 // Freeze the clock in the disposable transaction only.
 await q(migration.replaceAll('clock_timestamp()', "('"+at+"'::timestamptz)"));
 assert.equal((await admit(key,[])).ok,'f','owner has not enabled results');
 await q('UPDATE patreon_season_config SET results_enabled_from=$1 WHERE singleton',[day]);
 const make=async()=>{
  const auth_id=randomUUID(),player=randomUUID(),name='Fixture '+player.slice(0,8);
  await q('INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt") VALUES($1::uuid,$2,$3,true,now())',[auth_id,'Fixture',auth_id+'@example.invalid']);
  await q('INSERT INTO players(id,display_name,username_owned) VALUES($1,$2,true)',[player,name]);
  await q('INSERT INTO account_links(auth_user_id,player_id) VALUES($1,$2)',[auth_id,player]);
  return {auth_id,player,name};
 };
 const a=await make(),b=await make(),c=await make();
 const placements=[a,b,c].map(({auth_id,name})=>({auth_id,name}));
 await q('INSERT INTO results_preferences(auth_user_id,exclude_publications) VALUES($1,true)',[b.auth_id]);
 assert.equal((await admit(key,placements)).ok,'f');
 await q('UPDATE results_preferences SET exclude_publications=false WHERE auth_user_id=$1',[b.auth_id]);
 await q('UPDATE players SET public_identity_hidden_at=now() WHERE id=$1',[c.player]);
 assert.equal((await admit(key,placements)).ok,'f');
 await q('UPDATE players SET public_identity_hidden_at=NULL WHERE id=$1',[c.player]);
 assert.equal((await admit(key,placements)).ok,'t');
 assert.equal((await admit(key,placements)).ok,'f','no second handoff');
 await q('SELECT * FROM pack1_begin_account_deletion($1::uuid,$2::uuid)',[b.auth_id,b.player]);
 const pending=await first('SELECT auth_user_id,deletion_requested_at FROM patreon_season_pending_names WHERE post_key=$1 AND name_to_remove=$2',[key,b.name]);
 assert.equal(pending.auth_user_id,null);assert.ok(pending.deletion_requested_at);
 await q('INSERT INTO results_preferences(auth_user_id,exclude_publications) VALUES($1,true)',[c.auth_id]);
 const finish=()=>first('SELECT pack1_patreon_season_finish($1,$2,$3::timestamptz) ok',[key,link,at]);
 assert.equal((await finish()).ok,'t');assert.equal((await finish()).ok,'t');
 const records=(await q('SELECT p.auth_user_id,p.name_to_remove,t.reason FROM results_publications p LEFT JOIN results_removal_tasks t ON p.id=t.publication_id WHERE p.link=$1',[link])).rows;
 assert.equal(records.length,3);
 assert.equal(records.find(r=>r.name_to_remove===a.name).auth_user_id,a.auth_id);
 assert.equal(records.find(r=>r.name_to_remove===b.name).reason,'deletion');
 assert.equal(records.find(r=>r.name_to_remove===c.name).reason,'request');
 await claim(guideKey,'midseason-guide',next,day);
 assert.equal((await admit(guideKey,[])).ok,'f','unapproved guide cannot queue');
 await q("INSERT INTO patreon_midseason_plans(season_id,next_set_id,next_start,reviewed_on,revision) VALUES($1,'fixture-future','2030-02-20',$2,$3)",[next,day,hash]);
 await q("INSERT INTO patreon_midseason_drafts(season_id,milestone,plan_revision,evidence_sha256,title,body,article) VALUES($1,$2,$3,$3,'Fixture post','Fixture body','{}')",[next,day,hash]);
 assert.equal((await admit(guideKey,[])).ok,'f');
 await q("UPDATE patreon_midseason_drafts SET state='approved',approved_at=$2 WHERE season_id=$1",[next,at]);
 assert.equal((await admit(guideKey,[placements[0]])).ok,'f','guide cannot contain names');
 assert.equal((await admit(guideKey,[])).ok,'t');
 assert.equal((await admit(guideKey,[])).ok,'f');
 console.log('PASS season receipt, cutoff, consent, deletion/removal, approved aggregate draft and no duplicate handoff');
}finally{await q('ROLLBACK').catch(()=>{});client.release();await pool.end();}
