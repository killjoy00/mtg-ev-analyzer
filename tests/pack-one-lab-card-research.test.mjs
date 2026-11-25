import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStoredSet} from '../research/pack-one-lab/stored-corpus.mjs';
import {cardResearchPackets,validateCardResearch} from '../research/pack-one-lab/card-research.mjs';
import {attachCopyOutcomes,validateCopyOutcomes,readCopyOutcomes} from '../research/pack-one-lab/copy-outcomes.mjs';
import {assembleArticle,generationEvidence,makeArticle} from '../worker/lab-writer.mjs';

const meta=(set_id='fixture-a',set_name='Fixture A')=>({set_id,set_name,corpus_version:'fixture-corpus',source_snapshot_id:'a'.repeat(64),draft_sha256:'b'.repeat(64),game_sha256:'c'.repeat(64)});
const card=(id,name,rarity='common',type_line='Creature',mana_cost='{1}{U}')=>({id,name,rarity,type_line,mana_cost,multi_face:false});
const alpha=card('alpha','Alpha Study'),beta=card('beta','Beta Study','common','Instant'),rare=card('rare','Rare Example','rare','Sorcery'),body=card('body','Steady Body','uncommon'),alpha2={...alpha,id:'alpha-other-printing'};
const spells=Array.from({length:6},(_,i)=>card('spell-'+i,'Fixture Spell '+i,'uncommon','Sorcery'));
function rowsFor(variant=0){
  const rows=[];
  for(let i=0;i<400;i++){
    for(let pick_number=1;pick_number<=8;pick_number++){
      const p=pick_number;
      // Alpha is selected early for the first 80 sources, then more often
      // when already in the pool. Both exact-name printings may be offered.
      let chosen;
      if(p===1)chosen=i<80?'alpha':i<100?'beta':i<110?'rare':spells[variant===0?(i%6):variant===1?(i<350?0:1+i%5):(i%5)].id;
      else if(p===2||p===3)chosen='body';
      else if(p===4||p===5||p===6||p===7||p===8)chosen=i<80?'alpha':i<100?'beta':'body';
      const candidates=[alpha,alpha2,beta,rare,body,...spells];
      rows.push({source_draft_hash:i.toString(16).padStart(32,'0'),pick_number,historical_pick_id:chosen,candidates});
    }
  }
  return rows;
}
const report=sets=>({schema_version:1,kind:'stored-corpus',sets});
const metrics=p=>p.metrics.filter(m=>p.focus_metrics.includes(m.id));
test('named opportunities deduplicate printings, exact repeat groups and actual rare co-offers',()=>{
  const summary=summarizeStoredSet(meta(),rowsFor(),null),raw=summary.card_research;
  assert.equal(raw.complete,400);
  const a=raw.cards.find(c=>c.name==='Alpha Study');
  assert.equal(a.rare.n,400);
  assert.equal(a.rare.picked,80);
  assert.deepEqual(a.repeat.prior,{n:400,picked:400,drafts:80});
  assert.deepEqual(a.repeat.fresh,{n:1600,picked:0,drafts:320});
  assert.ok(a.pairs.some(p=>p.name==='Rare Example'&&p.n===400&&p.picked===80));
  const packets=cardResearchPackets(report([summary]));
  const rarePacket=packets.find(p=>p.research_context.family==='commons-over-rares');
  assert.equal(metrics(rarePacket)[0].denominator,400);
  assert.equal(metrics(rarePacket)[0].percent,20);
  const repeat=packets.find(p=>p.research_context.family==='repeat-card-context');
  assert.deepEqual(metrics(repeat).slice(0,2).map(m=>[m.numerator,m.denominator,m.percent]),[[0,1600,0],[400,400,100]]);
  assert.equal(repeat.research_context.fixed_stage_check.stage,4);
  assert.equal(repeat.support_metrics.length,2);
  assert.equal(repeat.research_context.qualified_cards,1);
  const privateKeys=JSON.stringify(raw);
  for(const key of ['source_draft_hash','historical_pick_id','candidates','00000000000000000000000000000000'])assert.ok(!privateKeys.includes(key));
});
test('comparison uses actual top five counts and the newest three sets only',()=>{
  const sets=[summarizeStoredSet(meta('a','Fixture A'),rowsFor(0),null),summarizeStoredSet(meta('b','Fixture B'),rowsFor(1),null),
    summarizeStoredSet(meta('c','Fixture C'),rowsFor(2),null),summarizeStoredSet(meta('d','Older fixture'),rowsFor(2),null)];
  const packet=cardResearchPackets(report(sets)).find(p=>p.kind==='stored-card-comparison');
  assert.ok(packet);
  assert.deepEqual(packet.sets,['Fixture A','Fixture B','Fixture C']);
  assert.ok(!packet.research_context.leaders.some(s=>s.set==='Older fixture'));
  for(const [i,leader] of packet.research_context.leaders.entries()){
    assert.equal(leader.cards.reduce((n,c)=>n+c.picks,0),packet.metrics[i].numerator);
    const check=packet.metrics.find(m=>m.id===packet.metrics[i].id+'-without-leader');
    assert.equal(check.numerator,packet.metrics[i].numerator-leader.cards[0].picks);
    assert.equal(check.denominator,packet.metrics[i].denominator-leader.cards[0].picks);
  }
});
test('unsafe or inconsistent aggregate counts and incomplete or low-support data cannot create a lead',()=>{
  const full=summarizeStoredSet(meta(),rowsFor(),null);
  const bad=JSON.parse(JSON.stringify(full));
  bad.card_research.cards.find(c=>c.name==='Alpha Study').repeat.prior.drafts=401;
  assert.throws(()=>cardResearchPackets(report([bad])),/lab-card-research/);
  const bad2=JSON.parse(JSON.stringify(full));bad2.card_research.noncreature_picks++;
  assert.throws(()=>validateCardResearch(bad2.card_research,400),/lab-card-research/);
  const tiny=summarizeStoredSet(meta(),rowsFor().slice(0,80),null);
  assert.deepEqual(cardResearchPackets(report([tiny])),[]);
  const incomplete=summarizeStoredSet(meta(),rowsFor().filter(r=>r.pick_number!==8),null);
  assert.deepEqual(cardResearchPackets(report([incomplete])),[]);
});
test('writer requires a specific supported lead, keeps exact counts and allows short findings',async()=>{
  const packet=cardResearchPackets(report([summarizeStoredSet(meta(),rowsFor(),null)])).find(p=>p.research_context.family==='commons-over-rares');
  const copy={title:'Alpha Study has competition',lead:'Alpha Study stands out even when an opening pack offers a rare spell.',
    sections:[{heading:'',text:'The useful comparison is the choice actually available, not a rarity label. Rare Example was present in the same packs. That does not make every rare an inferior pick.'}],closing:''};
  const article=assembleArticle(packet,copy);
  assert.equal(article.schema_version,2);
  assert.match(article.body,/Alpha Study: 20\.0% \(80 of 400\)/);
  assert.match(article.body,/Named rare co-offers/);
  assert.equal(article.research_context.family,'commons-over-rares');
  assert.throws(()=>assembleArticle(packet,{...copy,title:'A general drafting thought',lead:'Opening picks can be difficult when a rare is present.',sections:[{heading:'',text:'There is always a tradeoff in draft. Players may prefer different types of cards and may have different plans for the format. Consider the choices carefully before committing.'}]}),/lab-missing-card-specific-prose/);
  assert.throws(()=>assembleArticle(packet,{...copy,lead:'Alpha Study wins 90% of games.'}),/lab-unverified-prose/);
  let reviewed=false;
  const result=await makeArticle(packet,{writer:async()=>copy,reviewer:async(_instruction,payload)=>{reviewed=true;assert.equal(payload.evidence.research_context.family,'commons-over-rares');assert.ok(payload.evidence.support_metrics.length);return {verdict:'pass',feedback:''};}});
  assert.ok(reviewed);
  assert.ok(result);
});

test('near-unanimous opening choices retain complete named exceptions only',()=>{
  const rs=rowsFor().map(r=>{
    const i=parseInt(r.source_draft_hash,16);
    if(r.pick_number!==1)return r;
    const chosen=i<46?'spell-0':i===46?'spell-1':i===47?'rare':i<210?'spell-1':i<350?'spell-2':i<375?'spell-3':'spell-4';
    return {...r,historical_pick_id:chosen,candidates:i<48?r.candidates:r.candidates.filter(c=>c.id!=='spell-0')};
  });
  const set=summarizeStoredSet(meta(),rs,null),packet=cardResearchPackets(report([set])).find(p=>p.research_context.family==='opening-spells');
  const e=packet.research_context.near_unanimous_exceptions.find(c=>c.card==='Fixture Spell 0');
  assert.equal(e.offered,48);
  assert.equal(e.selected,46);
  assert.deepEqual(e.alternatives.map(c=>[c.name,c.picked,c.rarity]),[['Fixture Spell 1',1,'uncommon'],['Rare Example',1,'rare']]);
});


test('plain-language guide allows a short, verified-stat lead without sections or forced summary',()=>{
  const p=cardResearchPackets(report([summarizeStoredSet(meta(),rowsFor(),null)])).find(p=>p.research_context.family==='commons-over-rares');
  const short={title:'Alpha Study in opening packs',lead:'Alpha Study showed up in [stat:common-0:d] opening packs with a rare. Trophy drafters took it [stat:common-0:n] times.',sections:[],closing:''};
  const a=assembleArticle(p,short);
  assert.equal(a.style_version,'lab-plain-v1');
  assert.equal(a.blocks[0].type,'paragraph');
  assert.equal(a.blocks[0].text,'Alpha Study showed up in 400 opening packs with a rare. Trophy drafters took it 80 times.');
  assert.equal(a.blocks[1].type,'chart');
  assert.ok(!a.body.includes('[stat:'));
  assert.ok(generationEvidence(p).inline_stats.some(s=>s.numerator==='[stat:common-0:n]'));
  assert.throws(()=>assembleArticle(p,{...short,lead:'Alpha Study was taken 80 times.'}),/lab-unverified-prose/);
  assert.throws(()=>assembleArticle(p,{...short,lead:'Alpha Study was taken [stat:invented:n] times.'}),/lab-unverified-stat/);
  assert.throws(()=>assembleArticle(p,{...short,lead:"Here's where it gets interesting. "+short.lead}),/lab-style-stock-transition/);
  assert.throws(()=>assembleArticle(p,{...short,lead:short.lead+' A surprise — surely.'}),/lab-style-em-dash/);
  assert.throws(()=>assembleArticle(p,{...short,sections:[{heading:'What this means',text:'Alpha Study is a common.'}]}),/lab-style-generic-heading/);
  assert.throws(()=>assembleArticle(p,{...short,lead:short.lead+' Why? What now?'}),/lab-style-question-count/);
});


test('copy-count follow-up preserves a contradictory comparable group and requires real prose',async()=>{
  const m=meta(),set=summarizeStoredSet(m,rowsFor(),null);
  const raw={schema_version:1,definition:'copy-outcomes-v1',set_id:m.set_id,event_type:'PremierDraft',source_sha256:m.game_sha256,
    source:'17Lands public game data (CC BY 4.0)',raw_games:1000,games:1000,wins:530,drafts:200,invalid_games:0,duplicate_games:0,known_stratum_games:600,minimum_games:150,minimum_drafts:30,
    cards:{'Alpha Study':{all:{'1':[125,300,70],'2+':[160,300,70],'2':[100,180,45]},strata:{'UG|60plus':{'1':[90,150,40],'2+':[60,150,40]},'UB|50to59':{'1':[35,150,30],'2+':[100,150,30]}}}}};
  validateCopyOutcomes(raw,m);
  const context={report:raw,artifact_sha256:'d'.repeat(64)};
  const p=cardResearchPackets(report([{...set,copy_outcomes:context}])).find(p=>p.research_context.family==='repeat-card-context');
  const outcome=p.research_context.copy_outcomes;
  assert.equal(outcome.status,'measured');
  assert.equal(outcome.overall_direction,'higher');
  assert.equal(outcome.matched_group.key,'UG|60plus');
  assert.equal(outcome.matched_group.direction,'lower');
  assert.equal(p.provenance.hashes.copy_outcomes,context.artifact_sha256);
  const copy={title:'Do more copies of Alpha Study help?',lead:'Trophy drafters took Alpha Study [stat:repeat-0-fresh:pct] of the time without a prior copy and [stat:repeat-0-prior:pct] with one.',
    sections:[{heading:'',text:'Across all recorded games, decks with one copy won [stat:copy-one:pct] of their games, versus [stat:copy-multiple:pct] with multiple copies. But among experienced blue-green drafters with the highest prior skill bucket, the rates were [stat:copy-matched-one:pct] and [stat:copy-matched-multiple:pct]. Color and player selection may explain the overall difference.'}],closing:'The second copy may fit the pool, but these games give little reason to assume it wins more in every deck.'};
  const a=assembleArticle(p,copy);
  assert.ok(a.blocks.some(b=>b.type==='outcome-chart'));
  assert.match(a.artwork.outcome_chart_alt,/One copy: 41\.7%/);
  assert.match(a.artwork.outcome_chart_alt,/Two or more copies: 53\.3%/);
  assert.match(a.body,/60\.0% and 40\.0%/);
  assert.equal(a.research_context.copy_outcomes.matched_group.direction,'lower');
  assert.throws(()=>assembleArticle(p,{...copy,sections:[],closing:''}),/lab-missing-follow-up/);
  assert.throws(()=>assembleArticle(p,{...copy,sections:[{heading:'',text:'The game rates were [stat:copy-one:pct] and [stat:copy-multiple:pct].'}]}),/lab-missing-matched-follow-up/);
  const original=cardResearchPackets(report([set])).find(p=>p.research_context.family==='repeat-card-context');
  assert.equal(original.research_context.copy_outcomes.status,'unavailable');
  assert.throws(()=>attachCopyOutcomes(original,{...m,game_sha256:'a'.repeat(64)},context),/lab-copy-outcomes-invalid/);
  const bad=structuredClone(raw);bad.cards['Alpha Study'].all['2+'][0]=301;
  assert.throws(()=>validateCopyOutcomes(bad,m),/lab-copy-outcomes-invalid/);
  const badGroup=structuredClone(raw);badGroup.known_stratum_games=300;
  assert.throws(()=>validateCopyOutcomes(badGroup,m),/lab-copy-outcomes-invalid/);
  let reviewed=false;
  assert.ok(await makeArticle(p,{writer:async()=>copy,reviewer:async(instruction,input)=>{
    assert.match(instruction,/contradictory matched rates/);
    assert.equal(input.evidence.research_context.copy_outcomes.matched_group.direction,'lower');
    reviewed=true;return {verdict:'pass',feedback:''};
  }}));
  assert.ok(reviewed);
});
