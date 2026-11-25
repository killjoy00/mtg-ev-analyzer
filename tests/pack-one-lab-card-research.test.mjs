import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStoredSet} from '../research/pack-one-lab/stored-corpus.mjs';
import {cardResearchPackets,validateCardResearch} from '../research/pack-one-lab/card-research.mjs';
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
  for(const [i,leader] of packet.research_context.leaders.entries())assert.equal(leader.cards.reduce((n,c)=>n+c.picks,0),packet.metrics[i].numerator);
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
