import test from 'node:test';
import assert from 'node:assert/strict';
import {articleArtwork} from '../research/pack-one-lab/artwork.mjs';
import {articleHash} from '../worker/lab-editorial.mjs';
import {labPost,labPresentationHash,validateLabPrepared} from '../lab-patreon-contract.mjs';
import {labDeviceAction} from '../worker/lab-publisher.mjs';
import {runPairedLabTick} from '../scripts/pack-one-weekly-private-runner.mjs';
import {openSnapshot,sealSnapshot} from '../worker/weekly-publisher.mjs';
const week='2026-12-07',now=new Date('2026-12-11T18:01:00Z');
const title='Fixture duplicate copies',text='Fixture comparison for the reviewed article.';
const artwork=articleArtwork({title,set:'Fixture Set',mode:'quick-hit',metrics:[{label:'One copy',numerator:60,denominator:100,percent:60},{label:'Two copies',numerator:65,denominator:100,percent:65}]});
const article={schema_version:2,title,body:text,blocks:[{type:'paragraph',text},{type:'chart'}],source:'Fixture source.',artwork,research_context:{private:'not a presentation field'}};
const post=labPost(article),digest=labPresentationHash(post),approvedHash=articleHash(article),ticketEnv={PACK1_RATE_LIMIT_SECRET:'fixture-test-only-secret-0000000000000'},tokenHash='a'.repeat(64);
const img=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(6000,7)]);
const media=async()=>({jpeg:img,width:960,height:1400});
const ready={status:'prepared',week,revision:2,article_hash:approvedHash,presentation_sha256:digest,...post,ticket:'fixture-ticket'};
test('only approved presentation and exact text, reject altered and unsafe content',()=>{
 assert.deepEqual(Object.keys(post),['title','body','artwork']);assert.ok(!JSON.stringify(post).includes('private'));
 assert.equal(validateLabPrepared(ready),ready);
 assert.throws(()=>validateLabPrepared({...ready,body:ready.body.replace('Fixture comparison','Changed')}),/lab-publication-invalid/);
 assert.throws(()=>labPost({...article,body:'changed'}),/lab-publication-invalid/);
 assert.throws(()=>labPost({...article,schema_version:1}),/lab-publication-invalid/);
 assert.throws(()=>labPost({...article,artwork:{...artwork,cover_svg:artwork.cover_svg.replace('</svg>','<script>alert(1)</script></svg>')}}),/lab-publication-invalid/);
 assert.throws(()=>labPost({...article,body:'a'.repeat(4000),blocks:[{type:'paragraph',text:'a'.repeat(4000)},{type:'chart'}]}),/lab-publication-invalid/);
});
test('server defaults to disabled, validates hash and only exposes approved due article',async()=>{
 let approve=true,lookups=0,changed=false;
 const query=async(sql)=>{
  if(sql.includes('to_regclass'))return {rows:[{ready:true}]};
  if(sql.includes('FROM patreon_lab_runs'))return {rows:[]};
  if(sql.includes('FROM pack1_lab_issues'))return {rows:approve?[{revision:2,article_hash:approvedHash,article:changed?{...article,title:'Changed'}:article}]:[]};
  throw Error('unexpected query');
 };
 const base={query,clock:()=>now,find:async()=>{lookups++;return null;},tokenHash,seal:d=>sealSnapshot(d,ticketEnv),open:(t,o)=>openSnapshot(t,ticketEnv,o)};
 assert.deepEqual(await labDeviceAction({action:'lab-prepare'},base),{status:'lab-disabled'});assert.equal(lookups,0);
 approve=false;assert.equal((await labDeviceAction({action:'lab-prepare'},{...base,enabled:true})).status,'lab-awaiting-approval');
 approve=true;changed=true;await assert.rejects(labDeviceAction({action:'lab-prepare'},{...base,enabled:true}),/lab-approval-changed/);
 changed=false;
 const result=await labDeviceAction({action:'lab-prepare'},{...base,enabled:true});
 assert.equal(result.presentation_sha256,digest);assert.ok(!JSON.stringify(result).includes('not a presentation field'));
 assert.equal(openSnapshot(result.ticket,ticketEnv,{tokenHash,now,expectedVersion:3}).article_hash,approvedHash);
 assert.throws(()=>openSnapshot(result.ticket,ticketEnv,{tokenHash,now,expectedVersion:2}),/invalid-snapshot/);
});
test('paired lane never stages unapproved work or repeats ambiguous queue, and reconciles readback',async()=>{
 let phase='disabled',queued=0,actions=[];
 const call=async(action,p={})=>{
  actions.push(action);
  if(action==='lab-status')return {pending:phase==='pending'?[{week,title:post.title,body:post.body,width:960,height:1400}]:[]};
  if(action==='lab-prepare')return phase==='disabled'?{status:'lab-disabled'}:phase==='pending'?{status:'receipt-exists'}:ready;
  if(action==='lab-claim')return {status:'claimed'};
  if(action==='lab-admit')return {status:'admitted'};
  if(action==='lab-review')return {status:'review-required'};
  if(action==='lab-find')return {found:{url:'https://www.patreon.com/posts/42',publishedAt:now.toISOString()}};
  if(action==='lab-finish'){assert.equal(p.week,week);return {status:'verified'};}
  throw Error(action);
 };
 const bridge=async(action,p)=>{if(action==='stage'){assert.equal(p.body,post.body);return {id:'fixture'};}queued++;phase='pending';throw Error('ambiguous');};
 assert.equal((await runPairedLabTick({call,bridge,capture:media})).status,'lab-disabled');assert.equal(queued,0);
 phase='ready';assert.equal((await runPairedLabTick({call,bridge,capture:media})).status,'review-required');assert.equal(queued,1);
 assert.equal((await runPairedLabTick({call,bridge,capture:media,verify:async()=>true})).status,'already-verified');
 assert.equal(queued,1);assert.ok(actions.includes('lab-finish'));
});
