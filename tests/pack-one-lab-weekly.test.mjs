import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {centralDate,fridayNoon,articleHash,reviewLab,handleLabAdmin,normalizeLabIssue,LAB_OWNER_URL} from '../worker/lab-editorial.mjs';
import {assembleArticle,makeArticle,pinnedPilotPackets} from '../worker/lab-writer.mjs';
import {phase,selectPackets,readPackets,cycle} from '../scripts/pack-one-lab-weekly.mjs';
import {sanitizeAdminDestination} from '../admin/admin-return.mjs';
import {adminPath} from '../edge/gateway.mjs';

const now=new Date('2026-12-02T15:00:00Z'),week='2026-11-30',hash='a'.repeat(64);
const owner='00000000-0000-4000-8000-000000000001';
const action={week,revision:1,hash,action:'approve'};
const packets=await readPackets();

test('Central schedule and Friday noon follow DST, week and review windows',()=>{
  assert.equal(centralDate(now).week,week);
  assert.equal(fridayNoon(week),'2026-12-04T18:00:00.000Z');
  assert.equal(fridayNoon('2026-07-06'),'2026-07-10T17:00:00.000Z');
  assert.equal(phase(new Date('2026-12-01T12:00:00Z')),'prepare');
  assert.equal(phase(new Date('2026-12-01T15:00:00Z')),'prepare');
  assert.equal(phase(now),'review');
  assert.equal(phase(new Date('2026-12-02T11:00:00Z')),'idle');
  assert.equal(phase(new Date('2026-12-05T18:00:00Z')),'idle');
  assert.equal(articleHash({b:2,a:1}),articleHash({a:1,b:2}));
  assert.notEqual(articleHash({a:1}),articleHash({a:2}));
});
test('owner-only route, exact revision/hash compare-and-set and no publication',async()=>{
  assert.equal(adminPath('/v1/admin/lab','GET'),true);
  assert.equal(adminPath('/v1/admin/lab/review','POST'),true);
  assert.equal(adminPath('/v1/admin/lab/review','GET'),false);
  assert.equal(adminPath('/v1/admin/lab/review/extra','POST'),false);
  const req=new Request('https://packone.pro/v1/admin/lab');
  await assert.rejects(handleLabAdmin(req,()=>{throw Error('query should not run');},()=>null,owner,'admin'),{status:403});
  let observed;
  const query=async(sql,params)=>{observed={sql,params};return {rows:[{state:'approved',revision:1}]}};
  const a=await reviewLab(query,owner,action,now);
  assert.equal(a.publishing_available,false);
  assert.equal(a.publish_at,'2026-12-04T18:00:00.000Z');
  assert.match(observed.sql,/revision=\$2 AND article_hash=\$3 AND state='review'/);
  assert.match(observed.sql,/role='owner'/);
  assert.match(observed.sql,/INSERT INTO pack1_lab_events/);
  assert.deepEqual(observed.params.slice(0,4),[week,1,hash,'approved']);
  await assert.rejects(reviewLab(async()=>({rows:[]}),owner,action,now),{status:409});
  await assert.rejects(reviewLab(query,owner,{...action,action:'revise'},now),{status:400});
  const revised=await reviewLab(query,owner,{...action,action:'revise',feedback:'Tighten the opening.'},now);
  assert.equal(revised.state,'revision_requested');
  assert.equal(revised.publish_at,null);
  assert.equal(observed.params[4],'Tighten the opening.');
  await assert.rejects(reviewLab(query,owner,action,new Date('2026-12-09T15:00:00Z')),{status:409});
});
function copy(){
  return {title:'The case for keeping options open',
    lead:'Imagine a promising black and red start. A blue spell and a dual land appear beside a playable black creature. Which would you take? Each option asks a different question about the pool you have and the deck you might end up building.',
    sections:[{heading:'A land is not a free pick',text:'A fixing land can make later choices possible, but taking it means passing a spell. Think about whether the land helps even if the tempting blue card never appears in the final deck. A deck with enough playables can afford to spend a pick on its mana; a thin pool may need the creature instead. A recorded splash describes the deck that was played, not the reason a drafter decided to splash.'}],
    closing:'Decide what the extra color would actually add before stretching the mana.'};
}
test('deterministic numbers, no invented numeric prose, reviewer must pass',async()=>{
  const p=packets[0],article=assembleArticle(p,copy());
  assert.match(article.body,/47\.5% \(13,513 of 28,424\)/);
  assert.match(article.body,/not the share of unique decks or drafts/);
  assert.equal(article.chart[0].numerator,13513);
  assert.throws(()=>assembleArticle(p,{...copy(),title:'Splashing wins 70%'}),/lab-unverified-prose/);
  assert.throws(()=>assembleArticle(p,{...copy(),lead:'We examined the data.'}),/lab-unverified-prose/);
  assert.equal(article.schema_version,2);
  assert.equal(article.editorial_mode,'draft-decision');
  assert.ok(article.artwork.cover_svg.includes('PACK ONE LAB'));
  assert.equal(article.blocks[0].type,'paragraph');
  assert.ok(!article.body.includes('Discussion:'));
  assert.notEqual(articleHash(article),articleHash({...article,artwork:{...article.artwork,cover_svg:'changed'}}));
  let writes=0,reviews=0;
  const result=await makeArticle(p,{writer:async()=>{writes++;return copy()},reviewer:async()=>({verdict:++reviews===2?'pass':'revise',feedback:'More careful interpretation.'})});
  assert.ok(result);
  assert.equal(writes,2);
  assert.equal(await makeArticle(p,{writer:async()=>copy(),reviewer:async()=>({verdict:'revise',feedback:'Not strong enough.'})}),null);
  await assert.rejects(makeArticle(p,{writer:async()=>copy(),reviewer:async()=>({verdict:'publish',feedback:''})}),/lab-reviewer-shape/);
});
test('weekly history and current alternative suppress prior topics; revision retains original',()=>{
  const [a,b]=packets;
  assert.deepEqual(selectPackets(packets,[{attempted_ids:[a.id]}],{state:'researching',attempted_ids:[]}).map(p=>p.id),[b.id]);
  assert.deepEqual(selectPackets(packets,[],{state:'alternative_requested',attempted_ids:[a.id]}).map(p=>p.id),[b.id]);
  assert.deepEqual(selectPackets(packets,[{attempted_ids:[a.id]}],{state:'revision_requested',candidate_id:a.id,candidate_evidence:a,attempted_ids:[a.id]}).map(p=>p.id),[a.id]);
  assert.throws(()=>selectPackets(packets,[],{state:'revision_requested',candidate_id:a.id}),/lab-missing-frozen-evidence/);
});
test('disabled or approved queue does not send email or attempt publication',async()=>{
  let called=0;
  const query=async(sql)=>{called++;return {rows:sql.includes('SELECT week_key')?[{week,state:'approved',revision:1}]:[]}};
  const status=await cycle(query,{now,packets,writer:()=>{throw Error('no AI')},reviewer:()=>{throw Error('no reviewer')},fetcher:()=>{throw Error('no email')}});
  assert.equal(status,'terminal-no-publication');
  assert.equal(called,2);
  const workflow=readFileSync(new URL('../.github/workflows/pack-one-lab-review.yml',import.meta.url),'utf8');
  assert.match(workflow,/vars\.PACK1_LAB_REVIEW_ENABLED == 'true'/);
  assert.match(workflow,/environment: pack-one-lab-review/);
  assert.doesNotMatch(workflow,/upload-artifact|contents: write|publish.*patreon/i);
});

test('provider outage does not consume an unreviewed topic',async()=>{
  const writes=[];
  const query=async(sql)=>{
    if(sql.includes('SELECT week_key'))return {rows:[{week,state:'researching',revision:0,attempted_ids:[]}]};
    if(sql.includes('SELECT attempted_ids'))return {rows:[]};
    writes.push(sql);
    return {rows:[]};
  };
  await assert.rejects(cycle(query,{now,packets,writer:async()=>{throw Error('provider unavailable');},reviewer:async()=>{throw Error('should not review');}}),/provider unavailable/);
  assert.equal(writes.length,1);
  assert.match(writes[0],/INSERT INTO pack1_lab_issues/);
});

test('Neon raw-text row normalization, article integrity and sign-in-safe link',()=>{
  const article={title:'Fixture',body:'Fixture article',chart:[]};
  const hash=articleHash(article);
  const row={week,revision:'2',state:'review',article:JSON.stringify(article),hash,
    updated_at:'2026-12-02T15:00:00Z',publish_at:null};
  const normalized=normalizeLabIssue(row);
  assert.equal(normalized.revision,2);
  assert.deepEqual(normalized.article,article);
  assert.equal(normalized.updated_at,'2026-12-02T15:00:00.000Z');
  assert.equal(normalized.publish_at,null);
  assert.throws(()=>normalizeLabIssue({...row,article:JSON.stringify({...article,title:'Changed'})}),{status:503});
  assert.throws(()=>normalizeLabIssue({...row,revision:'NaN'}),{status:503});
  assert.throws(()=>normalizeLabIssue({...row,article:null}),{status:503});
  const u=new URL(LAB_OWNER_URL);
  assert.equal(sanitizeAdminDestination(u.pathname+u.search),u.pathname+u.search);
});

test('recent editorial form and theme influence topic selection, not frozen revisions',()=>{
  const [a,b]=packets;
  const candidates=[{...a,triage_score:95,theme:'mana',editorial_mode:'draft-decision'},
    {...b,triage_score:80,theme:'copies',editorial_mode:'quick-hit'}];
  const history=[{attempted_ids:[],editorial_mode:'draft-decision',theme:'mana'}];
  assert.equal(selectPackets(candidates,history,{state:'researching',attempted_ids:[]})[0].id,b.id);
  assert.equal(selectPackets(candidates,history,{state:'revision_requested',candidate_id:a.id,candidate_evidence:candidates[0]})[0].id,a.id);
});
