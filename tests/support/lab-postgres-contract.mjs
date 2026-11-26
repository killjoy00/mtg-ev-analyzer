// Real PostgreSQL contract, invoked only by the guarded local migration suite.
// All fixtures roll back; no live AI, mail or publishing calls.
import assert from 'node:assert/strict';
import {textTypes} from './postgres-fixture.mjs';
import {articleHash,readLab,reviewLab,centralDate,handleLabAdmin} from '../../worker/lab-editorial.mjs';
import {buildStoredCorpusReport,storedCorpusPackets} from '../../research/pack-one-lab/stored-corpus.mjs';
import {cardResearchPackets} from '../../research/pack-one-lab/card-research.mjs';
import {cycle,readPackets} from '../../scripts/pack-one-lab-weekly.mjs';
import {taskArticle,PENDING} from '../../scripts/pack-one-lab-task-bridge.mjs';
import {labDeviceAction} from '../../worker/lab-publisher.mjs';
import {openSnapshot,sealSnapshot} from '../../worker/weekly-publisher.mjs';

const sampleCopy=()=>({title:'The case for keeping options open',
    lead:'Imagine a promising black and red start. A blue spell and a dual land appear beside a playable black creature. Which would you take? Each option asks a different question about the pool you have and the deck you might end up building.',
    sections:[{heading:'A land is not a free pick',text:'A fixing land can make later choices possible, but taking it means passing a spell. Think about whether the land helps even if the tempting blue card never appears in the final deck. A deck with enough playables can afford to spend a pick on its mana; a thin pool may need the creature instead. A recorded splash describes the deck that was played, not the reason a drafter decided to splash.'}],
    closing:'Decide what the extra color would actually add before stretching the mana.'});

export async function verifyLabQueue(client){
  const q=(sql,params=[])=>client.query(sql,params);
  const raw=(sql,params=[])=>client.query({text:sql,values:params,types:textTypes});
  const now=new Date('2026-12-02T15:00:00Z'),week=centralDate(now).week;
  const packets=await readPackets();
  const nonOwner=crypto.randomUUID();
  await q('BEGIN');
  try{
    // The two views expose precisely the public-source projection; never
    // accidentally expand this interface to full payloads or account records.
    const columns=(await q("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='pack1_lab_corpus_picks' ORDER BY ordinal_position")).rows.map(x=>x.column_name);
    assert.deepEqual(columns,['set_id','set_name','release_date','corpus_version','source_snapshot_id','draft_sha256','game_sha256','source_draft_hash','pick_number','historical_pick_id','candidates']);
    const report=await buildStoredCorpusReport(q,{loadDeck:async()=>null});
    assert.equal(report.kind,'stored-corpus');
    assert.ok(Array.isArray(storedCorpusPackets(report)));
    assert.ok(Array.isArray(cardResearchPackets(report)));
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
    // Exercise the actual two-task handoff and scoped roles against PostgreSQL.
    const job={scope:'samples',week,revision:0,packet:packets[0]};
    await q('SET LOCAL ROLE pack1_lab_research_worker');
    try{
      assert.equal((await q("SELECT has_column_privilege(current_user,'public.pack1_lab_issues','approved_hash','UPDATE') AS approval, has_table_privilege(current_user,'public.players','SELECT') AS player")).rows[0].approval,false);
      assert.equal((await q("SELECT has_table_privilege(current_user,'public.players','SELECT') AS player")).rows[0].player,false);
      assert.equal(await taskArticle(q,job),PENDING);
    }finally{await q('SET LOCAL ROLE NONE');}
    await q('SET LOCAL ROLE pack1_lab_writer_task');
    try{
      assert.equal((await q("SELECT has_table_privilege(current_user,'public.pack1_lab_issues','UPDATE') AS approval, has_table_privilege(current_user,'public.draft_run_verified_puzzles','SELECT') AS raw")).rows[0].approval,false);
      assert.equal((await q("SELECT has_table_privilege(current_user,'public.draft_run_verified_puzzles','SELECT') AS raw")).rows[0].raw,false);
      assert.equal((await q("UPDATE public.pack1_lab_task_jobs SET writer_copy=$1::jsonb WHERE scope='samples' AND week_key=$2::date AND writer_copy IS NULL RETURNING request_hash",[JSON.stringify(sampleCopy()),week])).rows.length,1);
    }finally{await q('SET LOCAL ROLE NONE');}
    await q('SET LOCAL ROLE pack1_lab_research_worker');
    try{assert.equal(await taskArticle(q,job),PENDING);}finally{await q('SET LOCAL ROLE NONE');}
    await q('SET LOCAL ROLE pack1_lab_reviewer_task');
    try{
      assert.equal((await q("SELECT has_column_privilege(current_user,'public.pack1_lab_task_jobs','writer_copy','UPDATE') AS allowed")).rows[0].allowed,false);
      const row=(await q("SELECT review_hash FROM public.pack1_lab_task_jobs WHERE scope='samples' AND week_key=$1::date",[week])).rows[0];
      assert.match(row.review_hash,/^[a-f0-9]{64}$/);
      assert.equal((await q("UPDATE public.pack1_lab_task_jobs SET review_response=$1::jsonb WHERE scope='samples' AND week_key=$2::date AND review_hash=$3 AND review_response IS NULL RETURNING review_hash",[JSON.stringify({review_hash:row.review_hash,verdict:'pass',feedback:''}),week,row.review_hash])).rows.length,1);
    }finally{await q('SET LOCAL ROLE NONE');}
    const taskResult=await taskArticle(q,job);
    assert.equal(taskResult.schema_version,2);
    assert.equal(taskResult.chart[0].percent,47.5);
    assert.equal((await q('SELECT count(*)::int n FROM public.pack1_lab_issues WHERE week_key=$1::date',[week])).rows[0].n,0);
    await q('SAVEPOINT immutable_copy');
    await assert.rejects(q("UPDATE public.pack1_lab_task_jobs SET writer_copy='{}'::jsonb WHERE scope='samples' AND week_key=$1::date",[week]),/immutable/);
    await q('ROLLBACK TO SAVEPOINT immutable_copy');
    await q('RELEASE SAVEPOINT immutable_copy');
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
    assert.equal(first.article.schema_version,2);
    assert.ok(first.article.artwork.cover_svg.includes('PACK ONE LAB'));
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
    // Exercise the real SQL publication receipt lifecycle in the rollback-only DB.
    const publishNow=new Date(result.publish_at),tokenHash='a'.repeat(64),imageHash='b'.repeat(64);
    const ticketEnv={PACK1_RATE_LIMIT_SECRET:'fixture-lab-receipt-secret-0000000000'};
    let found=null;
    const device={query:raw,clock:()=>publishNow,find:async()=>found,tokenHash,seal:d=>sealSnapshot(d,ticketEnv),open:(t,o)=>openSnapshot(t,ticketEnv,o),metadata:b=>({hash:b.image_sha256,width:b.width,height:b.height})};
    assert.equal((await labDeviceAction({action:'lab-prepare'},device)).status,'lab-disabled');
    assert.equal((await labDeviceAction({action:'lab-prepare'},{...device,enabled:true,clock:()=>new Date(publishNow.getTime()-1)})).status,'lab-awaiting-approval');
    const enabled={...device,enabled:true};
    const prepared=await labDeviceAction({action:'lab-prepare'},enabled);
    assert.equal(prepared.status,'prepared');assert.equal(prepared.article_hash,approved.hash);assert.equal(prepared.revision,approved.revision);
    const params={ticket:prepared.ticket,image_sha256:imageHash};
    const claim={action:'lab-claim',...params,width:960,height:1400};
    assert.equal((await labDeviceAction(claim,enabled)).status,'claimed');
    assert.equal((await labDeviceAction(claim,enabled)).status,'receipt-exists');
    await assert.rejects(labDeviceAction({action:'lab-admit',...params},device),/lab-publication-disabled/);
    assert.equal((await labDeviceAction({action:'lab-admit',...params},enabled)).status,'admitted');
    await assert.rejects(labDeviceAction({action:'lab-admit',...params},enabled),/lab-claim-mismatch/);
    assert.equal((await labDeviceAction({action:'lab-queued',...params},enabled)).status,'queued-awaiting-verification');
    assert.equal((await labDeviceAction({action:'lab-status'},device)).pending.length,1);
    found={title:prepared.title,url:'https://www.patreon.com/posts/987654',publishedAt:publishNow.toISOString()};
    // Provider and browser are mocked; actual SQL receipt transitions are not.
    assert.equal((await labDeviceAction({action:'lab-find',week},device)).found.url,found.url);
    assert.equal((await labDeviceAction({action:'lab-finish',week,url:found.url,publishedAt:found.publishedAt,visualVerified:true},device)).status,'verified');
    assert.equal((await labDeviceAction({action:'lab-prepare'},enabled)).status,'already-verified');
    assert.equal((await readLab(raw)).issues.find(x=>x.week===week).publication.state,'verified');
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
