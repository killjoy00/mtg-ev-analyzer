import test from 'node:test';
import assert from 'node:assert/strict';
import {newsAudienceSnapshot} from '../worker/results-news-audience.mjs';
import {resultsEmailHash} from '../worker/results-privacy.mjs';
import {newsAudienceMarkup} from '../admin/results-email-campaigns.mjs';

const env={PACK1_RATE_LIMIT_SECRET:'fixture-signing-key-at-least-32-characters'};
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const subscriber=(n,overrides={})=>{
 const email='fixture-'+n+'@example.invalid';
 return {auth_user_id:uuid(n),email,verified:true,destination_hash:resultsEmailHash(email,env),
  do_not_contact:false,consent_ready:true,deleting:false,suppressed:false,...overrides};
};
const mock=(counts,pages)=>{
 const calls=[],copy=pages.slice();
 return {calls,query:async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('count(*) FILTER'))return {rows:[counts]};
  if(sql.includes('SELECT p.auth_user_id'))return {rows:copy.shift()||[]};
  throw Error('Unexpected query');}
 };
};

test('owner news audience counts only accounts passing consent, verification, address, deletion and both suppression gates',async()=>{
 const accounts=[
  subscriber(1),
  subscriber(2,{deleting:true}),
  subscriber(3,{do_not_contact:true}),
  subscriber(4,{verified:false}),
  subscriber(5,{consent_ready:false}),
  subscriber(6,{destination_hash:resultsEmailHash('previous@example.invalid',env)}),
  subscriber(7,{suppressed:true}),
  subscriber(8,{suppressed:true})
 ];
 const {query,calls}=mock({opted_in:8,opted_out:2,unanswered:3},[accounts]);
 const result=await newsAudienceSnapshot(query,{env});
 assert.equal(result.complete,true);
 assert.deepEqual(Object.fromEntries(['eligible','deleting','doNotContact','unverified','consentNotReady','addressChanged','suppressed'].map(k=>[k,result[k]])),
  {eligible:1,deleting:1,doNotContact:1,unverified:1,consentNotReady:1,addressChanged:1,suppressed:2});
 assert.equal(result.optedIn,8);
 assert.equal(result.optedOut,2);
 assert.equal(result.unanswered,3);
 assert.equal(Object.values(result).some(v=>typeof v==='string'&&v.includes('example.invalid')),false,'no address leaves the server');
 assert.equal(calls.length,2);
 assert.match(calls[1].sql,/LIMIT \$2::int/);
 assert.match(calls[1].sql,/account_deletion_operations/);
 assert.match(calls[1].sql,/daily_reminder_email_suppressions/);
 assert.match(calls[1].sql,/results_email_suppressions/);
 assert.match(calls[1].sql,/do_not_contact_at/);
});

test('bounded snapshot keyset-paginates without skipping subscribers',async()=>{
 const {query,calls}=mock({opted_in:251,opted_out:0,unanswered:0},[
  Array.from({length:250},(_,i)=>subscriber(i+1)),[subscriber(251)]
 ]);
 const result=await newsAudienceSnapshot(query,{env});
 assert.equal(result.eligible,251);
 assert.equal(result.complete,true);
 assert.equal(calls.length,3);
 assert.deepEqual(calls[2].params,[uuid(250),250]);
});

test('oversized or changing populations do not become false exact audience counts',async()=>{
 let state=mock({opted_in:5001},[]);
 let result=await newsAudienceSnapshot(state.query,{env});
 assert.equal(result.complete,false);assert.equal(result.eligible,null);assert.equal(state.calls.length,1);
 state=mock({opted_in:2},[[subscriber(1)]]);
 result=await newsAudienceSnapshot(state.query,{env});
 assert.equal(result.complete,false);assert.equal(result.reason,'changed_during_count');assert.equal(result.eligible,null);
});

test('audience UI uses plain language and only aggregate values',()=>{
 const value={complete:true,eligible:4,optedIn:12,optedOut:3,unanswered:5,
  deleting:1,doNotContact:2,unverified:1,consentNotReady:1,addressChanged:1,suppressed:2};
 const markup=newsAudienceMarkup(value);
 assert.match(markup,/4<\/strong> of <strong>12/);
 for(const term of ['Email unverified','Address changed since consent','Bounce or complaint','Do not contact','No news choice','not a delivery forecast'])
  assert.ok(markup.includes(term),term);
 assert.match(newsAudienceMarkup({complete:false}),/Audience check unavailable/);
 assert.doesNotMatch(markup,/mailto:|@example|<input|Send this campaign/);
});
