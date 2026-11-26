import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PENDING,taskArticle} from '../scripts/pack-one-lab-task-bridge.mjs';
import {readPackets,cycle} from '../scripts/pack-one-lab-weekly.mjs';
import {articleHash} from '../worker/lab-editorial.mjs';
const packet=(await readPackets())[0],week='2026-11-30';
const copy={title:'The case for keeping options open',lead:'Imagine a promising black and red start. A blue spell and a dual land appear beside a playable black creature. Which would you take? Each option asks a different question about the pool you have and the deck you might end up building.',
sections:[{heading:'A land is not a free pick',text:'A fixing land can make later choices possible, but taking it means passing a spell. Think about whether the land helps even if the tempting blue card never appears in the final deck. A deck with enough playables can afford to spend a pick on its mana; a thin pool may need the creature instead. A recorded splash describes the deck that was played, not the reason a drafter decided to splash.'}],closing:'Decide what the extra color would actually add before stretching the mana.'};
function fixture(){
 const rows=new Map();
 const query=async(sql,p)=>{
  const key=p.slice(0,5).join('|');
  if(sql.startsWith('SELECT request_json'))return {rows:rows.has(key)?[rows.get(key)]:[]};
  if(sql.startsWith('INSERT INTO public.pack1_lab_task_jobs')){if(!rows.has(key))rows.set(key,{request_json:JSON.parse(p[5]),request_hash:p[6],writer_copy:null,review_input:null,review_hash:null,review_response:null});return {rows:[]};}
  if(sql.startsWith('UPDATE public.pack1_lab_task_jobs')){const row=rows.get(key);assert.equal(row.request_hash,p[5]);assert.deepEqual(row.writer_copy,JSON.parse(p[6]));row.review_input=JSON.parse(p[7]);row.review_hash=p[8];return {rows:[]};}
  throw Error(sql);
 };
 return {rows,query,job:{week,revision:0,packet}};
}
test('task bridge waits for separate immutable copy and exact article review',async()=>{
 const {rows,query,job}=fixture();
 assert.equal(await taskArticle(query,job),PENDING);
 const row=[...rows.values()][0];
 assert.equal(row.request_json.packet_hash,articleHash(packet));
 assert.equal(await taskArticle(query,job),PENDING);
 row.writer_copy=copy;
 assert.equal(await taskArticle(query,job),PENDING);
 assert.equal(row.review_input.input.article.title,copy.title);
 assert.equal(await taskArticle(query,job),PENDING);
 row.review_response={review_hash:'0'.repeat(64),verdict:'pass',feedback:''};
 await assert.rejects(taskArticle(query,job),/review-response/);
 row.review_response={review_hash:row.review_hash,verdict:'pass',feedback:''};
 const article=await taskArticle(query,job);
 assert.equal(article.title,copy.title);
 assert.equal(article.chart[0].percent,47.5);
 row.writer_copy={...copy,title:'Changed title'};
 await assert.rejects(taskArticle(query,job),/review-integrity/);
});
test('review feedback requests new bounded attempt without consuming pending topic',async()=>{
 const {rows,query,job}=fixture();
 await taskArticle(query,job);
 const row=[...rows.values()][0];row.writer_copy=copy;
 await taskArticle(query,job);
 row.review_response={review_hash:row.review_hash,verdict:'revise',feedback:'Be specific.'};
 assert.equal(await taskArticle(query,job),PENDING);
 const next=[...rows.values()][1];
 assert.equal(next.request_json.input.feedback,'Be specific.');
 assert.equal(rows.size,2);
 next.writer_copy={};
 assert.equal(await taskArticle(query,job),PENDING);
 assert.equal(rows.size,3);
 [...rows.values()][2].writer_copy={};
 assert.equal(await taskArticle(query,job),null);
});
test('weekly pending request does not mark no-finding or consume topic',async()=>{
 const writes=[];
 const query=async sql=>{
  if(sql.startsWith('SELECT week_key'))return {rows:[{week,state:'researching',revision:0,attempted_ids:[]}]};
  if(sql.startsWith('SELECT attempted_ids'))return {rows:[]};
  writes.push(sql);return {rows:[]};
 };
 assert.equal(await cycle(query,{now:new Date('2026-12-02T15:00:00Z'),packets:[packet],generate:async()=>PENDING,fetcher:()=>{throw Error('no email');}}),'awaiting-chatgpt');
 assert.equal(writes.length,1);
 const workflow=readFileSync(new URL('../.github/workflows/pack-one-lab-review.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/PACK1_LAB_AI_KEY|PACK1_LAB_WRITER_MODEL|PACK1_LAB_REVIEWER_MODEL/);
 assert.doesNotMatch(readFileSync(new URL('../worker/lab-writer.mjs',import.meta.url),'utf8'),/api\.openai\.com|aiClient/);
});
