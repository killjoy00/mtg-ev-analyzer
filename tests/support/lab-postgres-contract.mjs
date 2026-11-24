// Real PostgreSQL contract, invoked only by the guarded local migration suite.
// All fixtures roll back; no live AI, mail or publishing calls.
import assert from 'node:assert/strict';
import {textTypes} from './postgres-fixture.mjs';
import {articleHash,readLab,reviewLab,centralDate,handleLabAdmin} from '../../worker/lab-editorial.mjs';
import {cycle,readPackets} from '../../scripts/pack-one-lab-weekly.mjs';

const sampleCopy=()=>({
  title:'The case for keeping options open',
  opening:'Imagine a promising black and red start. A blue spell and a dual land appear beside a playable black creature. Which would you take? The choices point in different directions, and your next few picks may change which one looks most appealing.',
  interpretation:('A fixing land can make later choices possible, but it still costs a pick. The card that fits your pool today may not be the card you need by the end of the draft. This observation describes a particular archive, not the best decision in a particular pack. Consider what each choice makes possible and which role your deck is missing. ').repeat(3),
  discussion:'When do you choose fixing over a solid playable spell?'
});

export async function verifyLabQueue(client){
  const q=(sql,params=[])=>client.query(sql,params);
  const raw=(sql,params=[])=>client.query({text:sql,values:params,types:textTypes});
  const now=new Date('2026-12-02T15:00:00Z'),week=centralDate(now).week;
  const packets=await readPackets();
  const nonOwner=crypto.randomUUID();
  await q('BEGIN');
  try{
    // The enclosing fixturePool permits only a disposable local database.
    // Reuse its sole Owner if present; otherwise create a rollback-only Owner.
    let owner=(await q("SELECT auth_user_id FROM pack1_admins WHERE role='owner'")).rows[0]?.auth_user_id;
    if(!owner){
      owner=crypto.randomUUID();
      await q('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[owner,'Lab fixture owner','lab-'+owner+'@example.invalid']);
      await q("INSERT INTO pack1_admins(auth_user_id,role) VALUES($1,'owner')",[owner]);
    }
    await q('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',[nonOwner,'Lab fixture admin','lab-'+nonOwner+'@example.invalid']);
    await q("INSERT INTO pack1_admins(auth_user_id,role) VALUES($1,'admin')",[nonOwner]);
    let calls=0,mail=[];
    const config={now,packets,writer:async()=>{calls++;return sampleCopy();},
      reviewer:async()=>({verdict:'pass',feedback:''}),
      env:{PACK1_LAB_RESEND_API_KEY:'re_fixture_not_a_real_secret'},
      fetcher:async(url,options)=>{
        assert.equal(url,'https://api.resend.com/emails');
        assert.equal(JSON.parse(options.body).to[0],'admin@packone.pro');
        assert.ok(!options.body.includes('47.5%'),'Email must not include article content');
        mail.push(options.headers['idempotency-key']);
        return Response.json({id:'fixture-receipt'});
      }};
    assert.equal(await cycle(q,config),'review-ready');
    const first=(await readLab(raw)).issues.find(x=>x.week===week);
    assert.equal(first.state,'review');assert.equal(first.revision,1);
    assert.equal(first.article.chart[0].percent,47.5);
    assert.equal(first.hash,articleHash(first.article));
    assert.ok(first.notification_sent_at);
    assert.equal(await cycle(q,config),'review-ready');
    assert.equal(calls,1);assert.equal(mail.length,1,'same revision cannot notify twice');

    const base={week,revision:first.revision,hash:first.hash};
    await assert.rejects(handleLabAdmin(new Request('https://packone.pro/v1/admin/lab'),raw,()=>null,nonOwner,'admin'),{status:403});
    await assert.rejects(reviewLab(q,nonOwner,{...base,action:'approve'},now),{status:409});
    await assert.rejects(reviewLab(q,owner,{...base,hash:'0'.repeat(64),action:'approve'},now),{status:409});
    const frozen=(await q('SELECT candidate_evidence FROM pack1_lab_issues WHERE week_key=$1::date',[week])).rows[0].candidate_evidence;
    assert.equal(frozen.id,packets[0].id);
    await reviewLab(q,owner,{...base,action:'revise',feedback:'Improve the hypothetical opening.'},now);
    // Deliberately remove the source pool: the revised article must use frozen evidence.
    assert.equal(await cycle(q,{...config,packets:[]}),'review-ready');
    const second=(await readLab(raw)).issues.find(x=>x.week===week);
    assert.equal(second.revision,2);assert.equal(mail.length,2);
    assert.notEqual(mail[0],mail[1]);
    assert.deepEqual(second.article.chart,first.article.chart);
    await assert.rejects(reviewLab(q,owner,{...base,action:'approve'},now),{status:409});
    const result=await reviewLab(q,owner,{week,revision:second.revision,hash:second.hash,action:'approve'},now);
    assert.equal(result.publishing_available,false);
    assert.equal(result.publish_at,'2026-12-04T18:00:00.000Z');
    assert.equal(await cycle(q,config),'terminal-no-publication');
    assert.equal(calls,2);assert.equal(mail.length,2);
    const approved=(await readLab(raw)).issues.find(x=>x.week===week);
    assert.equal(approved.state,'approved');assert.equal(approved.hash,approved.approved_hash);
    const events=(await q('SELECT action,revision FROM pack1_lab_events WHERE week_key=$1::date ORDER BY id',[week])).rows;
    assert.deepEqual(events,[{action:'review_ready',revision:1},{action:'revise',revision:1},{action:'review_ready',revision:2},{action:'approve',revision:2}]);
    // Prove schema constraints reject stale hashes and incomplete research cache.
    for(const [sql,params] of [
      ["UPDATE pack1_lab_issues SET approved_hash=$2 WHERE week_key=$1::date",[week,'0'.repeat(64)]],
      ["INSERT INTO pack1_lab_research(source_key,state) VALUES($1,'ready')",['fixture-invalid-ready']]
    ]){
      await q('SAVEPOINT invalid_lab');
      try{await assert.rejects(q(sql,params),{code:'23514'});}finally{await q('ROLLBACK TO SAVEPOINT invalid_lab');await q('RELEASE SAVEPOINT invalid_lab');}
    }
    console.log('PASS: Lab real SQL queue, raw-text owner read, revision integrity, mocked delivery deduplication, approval audit and constraints.');
  }finally{await q('ROLLBACK');}
}
