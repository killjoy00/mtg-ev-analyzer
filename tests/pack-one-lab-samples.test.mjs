import test from 'node:test';
import assert from 'node:assert/strict';
import {articleArtwork} from '../research/pack-one-lab/artwork.mjs';
import {articleHash} from '../worker/lab-editorial.mjs';
import {generateSampleBatch,runSampleBatch,featurePilotPlan,runTaskSamples} from '../scripts/pack-one-lab-samples.mjs';
const models={writer:'fixture-writer',reviewer:'fixture-reviewer'};
const packet=i=>({id:'fixture-'+i,kind:'stored-card-analysis',theme:'theme-'+i,triage_score:100-i,editorial_mode:'quick-hit'});
const fakeArticle=p=>{const text='Fixture analysis.',title='Fixture '+p.id;return {schema_version:2,title,body:text,source:'Fixture source.',theme:p.theme,editorial_mode:'quick-hit',blocks:[{type:'paragraph',text},{type:'chart'}],artwork:articleArtwork({title,set:'Fixture',mode:'quick-hit',metrics:[{label:'Observed picks',numerator:60,denominator:100,percent:60}]})};};
test('private sample batch limits actual generated work, preserves exact content and never pads failures',async()=>{
 const packets=Array.from({length:12},(_,i)=>packet(i));
 let calls=0;
 const batch=await generateSampleBatch(packets,{models,generate:async p=>{calls++;return calls===1?null:fakeArticle(p);}});
 assert.equal(batch.status,'complete');assert.equal(batch.articles.length,5);assert.equal(batch.attempted_count,6);
 assert.equal(new Set(batch.articles.map(a=>a.candidate_id)).size,5);
 for(const a of batch.articles)assert.equal(a.article_hash,articleHash(a.article));
 const partial=await generateSampleBatch(packets,{models,generate:async()=>null});
 assert.equal(partial.articles.length,0);assert.equal(partial.status,'partial');assert.equal(partial.attempted_count,10);
 await assert.rejects(generateSampleBatch([{...packet(1),kind:'historical'}],{models}),/lab-samples-source/);
 await assert.rejects(generateSampleBatch(packets,{models:{writer:'same',reviewer:'same'}}),/distinct-models/);
});
test('sample run reads a snapshot and only writes to private samples table',async()=>{
 const calls=[];
 const query=async(sql,args)=>{calls.push(sql);if(sql.startsWith('INSERT INTO pack1_lab_sample_batches')){assert.equal(articleHash(JSON.parse(args[1])),args[2]);return {rows:[{singleton:true}]};}return {rows:[]};};
 const result=await runSampleBatch(query,{models,build:async q=>{await q('SELECT approved projected evidence',[]);return {};},packetsFor:()=>[]});
 assert.equal(result.count,0);
 assert.deepEqual(calls.slice(0,3),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','SELECT approved projected evidence','COMMIT']);
 assert.equal(calls.length,4);assert.match(calls[3],/^INSERT INTO pack1_lab_sample_batches/);
});

test('feature pilot selects a fixed, diverse, bounded plan and preserves its terminal batch',async()=>{
 const source=Array.from({length:24},(_,i)=>({...packet(i),feature:{version:'feature-v2'},theme:'family-'+i%4}));
 const plan=featurePilotPlan([...source,packet(99)]);
 assert.equal(plan.length,10);
 assert.equal(new Set(plan.slice(0,4).map(p=>p.theme)).size,4);
 for(const theme of new Set(plan.map(p=>p.theme)))assert.ok(plan.filter(p=>p.theme===theme).length<=3);
 assert.deepEqual(featurePilotPlan(source),plan);
 const calls=[];
 const query=async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT sample_json'))return {rows:[]};if(sql.startsWith('INSERT INTO pack1_lab_sample_batches')){const b=JSON.parse(args[1]);assert.equal(b.pilot_version,'feature-v2');assert.equal(b.status,'complete');assert.equal(new Set(b.articles.map(a=>a.article.theme)).size>=3,true);return {rows:[{singleton:true}]};}throw Error(sql);};
 const result=await runTaskSamples(query,{now:new Date('2026-11-26T19:00:00Z'),packets:source,generate:async(q,j)=>{assert.equal(j.revision,1);assert.equal(j.scope,'samples');return {...fakeArticle(j.packet),style_version:'feature-v2'};}});
 assert.equal(result.count,5);
 const saved=await runTaskSamples(async sql=>{assert.match(sql,/SELECT sample_json/);return {rows:[{sample_json:{pilot_version:'feature-v2',status:'complete',articles:Array(5),attempted_count:8}}]};},{packets:[],generate:()=>{throw Error('already terminal');}});
 assert.equal(saved.count,5);
});
