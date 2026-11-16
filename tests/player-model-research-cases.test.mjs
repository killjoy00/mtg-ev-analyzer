import test from 'node:test';
import assert from 'node:assert/strict';
import {adminPath} from '../edge/gateway.mjs';
import {handleAdmin} from '../worker/measurement-admin.mjs';
import {
  RESEARCH_CASES_SQL,RESEARCH_CORPUS,RESEARCH_MIN_CHOICES,RESEARCH_MAX_PUZZLES,
  buildModelResearchCases,simpleCastColors,strongPoolColour,wilsonLower95,stageForPick,
} from '../worker/player-model-research-cases.mjs';

const card=(id,cost,type='Creature')=>({
  id,name:id.toUpperCase(),mana_cost:cost,type_line:type,image_url:null,
  model_probability:id==='a'?0.55:id==='b'?0.35:0.10,
});
const prior=[
  {id:'g1',name:'G1',mana_cost:'{1}{G}',type_line:'Creature'},
  {id:'g2',name:'G2',mana_cost:'{2}{G}',type_line:'Creature'},
  {id:'g3',name:'G3',mana_cost:'{G}',type_line:'Instant'},
];
const makeRow=(id,{environment='powered-cube',source='draft-'+id,votes={a:10,b:80,c:10},pick=4}={})=>({
  environment,puzzle_id:id,corpus_version:RESEARCH_CORPUS,
  n:Object.values(votes).reduce((a,b)=>a+b,0),votes,
  set_id:'synthetic',pick_number:pick,source_draft_hash:source,historical_pick_id:'b',
  prior_picks:pick===4?prior:Array.from({length:pick-1},(_,i)=>prior[i%3]),
  candidates:[card('a','{3}{U}'),card('b','{G}'),card('c','{3}')],
});

test('read-only SQL uses the original first-time daily cohort and bounded public-puzzle material',()=>{
  assert.match(RESEARCH_CASES_SQL,/NOT is_qa AND first_encounter AND outcome='pick'/);
  assert.match(RESEARCH_CASES_SQL,/run_type='daily' AND observed/);
  assert.match(RESEARCH_CASES_SQL,/HAVING sum\(votes\)>=\$3::int/);
  assert.match(RESEARCH_CASES_SQL,/p.corpus_version=\$4::text/);
  assert.match(RESEARCH_CASES_SQL,/LIMIT 1001/);
  assert.equal(RESEARCH_MIN_CHOICES,50);
  assert.equal(RESEARCH_MAX_PUZZLES,1000);
  assert.doesNotMatch(RESEARCH_CASES_SQL,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  assert.doesNotMatch(RESEARCH_CASES_SQL,/SELECT\s+(?:s\.)?player_id|jsonb_agg\(.*player_id/i);
});

test('exact printed mana is conservative about hybrids, lands and unknown faces',()=>{
  assert.deepEqual(simpleCastColors({mana_cost:'{2}{G}{G}',type_line:'Creature'}),['G']);
  assert.deepEqual(simpleCastColors({mana_cost:'{1}{W}{U}',type_line:'Instant'}),['U','W']);
  assert.equal(simpleCastColors({mana_cost:'{G/P}',type_line:'Creature'}),null);
  assert.equal(simpleCastColors({mana_cost:'{G}{U}',type_line:'Land'}),null);
  assert.equal(simpleCastColors({mana_cost:'',type_line:'Creature'}),null);
  assert.equal(simpleCastColors({mana_cost:null,type_line:'Creature'}),null);
  assert.equal(strongPoolColour(prior),'G');
  assert.equal(strongPoolColour(prior.slice(0,2)),null);
  assert.deepEqual([2,4,8].map(stageForPick),['early','middle','late']);
});

test('Wilson interval measures first-time selection uncertainty, not player skill',()=>{
  assert.ok(wilsonLower95(80,100)>0.70);
  assert.ok(wilsonLower95(80,100)<0.80);
  assert.ok(wilsonLower95(8,10)<wilsonLower95(80,100));
  assert.throws(()=>wilsonLower95(101,100));
});

test('blinded packet omits every model, player-choice, outcome and hypothesis field',()=>{
  const samples=[makeRow('puzzle-one'),makeRow('puzzle-two',{votes:{a:85,b:10,c:5}})];
  const blind=buildModelResearchCases(samples,{view:'blind'});
  const key=buildModelResearchCases(samples,{view:'diagnosis'});
  assert.equal(blind.review_cases,2);
  assert.deepEqual(blind.cases.map(c=>c.review_id),key.cases.map(c=>c.review_id));
  assert.ok(key.cases.some(c=>c.tags.includes('pool-color-tension')));
  assert.ok(key.cases.some(c=>c.player_favorite_trophy));
  assert.ok(blind.cases.every(c=>c.prior_picks.length===3&&c.candidates.length===3));
  const text=JSON.stringify(blind);
  for(const forbidden of ['model_probability','historical_pick_id','trophy_pick','votes','player_favorite','model_favorite','wilson_lower','tags','cohort','sample_size','supportGap','source_draft_hash']){
    assert.ok(!text.includes('"'+forbidden+'"'),forbidden+' must not appear in blind packet');
  }
  assert.notDeepEqual(blind.cases[0]?.candidates?.[0]?.model_probability,0.55);
});

test('source-distinct sampling uses diagnostic cases AND deterministic controls',()=>{
  const rows=[
    makeRow('case-one',{source:'repeat-source'}),
    makeRow('case-two',{source:'repeat-source',pick:5}),
    makeRow('case-three',{source:'different-source',votes:{a:90,b:5,c:5}}),
    makeRow('case-four',{source:'other-source',votes:{a:5,b:90,c:5}}),
  ];
  const first=buildModelResearchCases(rows,{view:'diagnosis'});
  const second=buildModelResearchCases([...rows].reverse(),{view:'diagnosis'});
  assert.deepEqual(first,second,'selection is independent of SQL row order');
  assert.equal(first.review_cases,3,'one case per source draft');
  assert.ok(first.cases.some(x=>x.player_favorite.id===x.model_favorite.id),'include controls');
  assert.ok(first.cases.some(x=>x.player_favorite.id!==x.model_favorite.id),'include disagreements');
});

test('fail closed on vote coverage, ties, broken model probability, and oversized windows',()=>{
  const wrongVotes=makeRow('bad-count');
  wrongVotes.votes={a:10,b:85,c:10};
  const tie=makeRow('bad-tie',{votes:{a:50,b:50}});
  const wrongModel=makeRow('bad-model');
  wrongModel.candidates[0].model_probability=0;
  const missingSource=makeRow('bad-source',{source:''});
  assert.equal(buildModelResearchCases([wrongVotes,tie,wrongModel,missingSource]).review_cases,0);
  assert.throws(()=>buildModelResearchCases(Array.from({length:1001},(_,i)=>makeRow('case-'+i))),/safety limit/);
  assert.throws(()=>buildModelResearchCases([],{view:'full'}),/research view/);
});

test('case endpoints are separately GET allowlisted and behind the same authenticated Admin gate',async()=>{
  assert.equal(adminPath('/v1/admin/measurements/research-cases','GET'),true);
  assert.equal(adminPath('/v1/admin/measurements/research-cases','POST'),false);
  let count=0;
  const query=async(sql,params=[])=>{
    if(sql.includes('FROM neon_auth.session s'))return {rows:[{user_id:'11111111-1111-4111-8111-111111111111'}]};
    if(sql.includes('SELECT role FROM pack1_admins'))return {rows:[{role:'owner'}]};
    if(sql.includes('WITH votes AS MATERIALIZED')){count++;assert.deepEqual(params.slice(2),[50,RESEARCH_CORPUS]);return {rows:[makeRow('puzzle-one')]};}
    throw Error('Unexpected SQL: '+sql.slice(0,50));
  };
  const req=mode=>new Request('https://packone.pro/v1/admin/measurements/research-cases?from=2020-01-01&to=2020-01-15&view='+mode,{
    headers:{'x-pack1-auth-session':'synthetic-admin-token'},
  });
  const packet=await handleAdmin(req('blind'),query,async()=>({}));
  assert.equal(packet.review_cases,1);
  assert.equal(packet.view,'blind');
  assert.equal(count,1);
  await assert.rejects(handleAdmin(req('forbidden'),query,async()=>({})),e=>e.status===400);
});
