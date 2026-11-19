import test from 'node:test';
import assert from 'node:assert/strict';
import {revisionSummary} from '../worker/revision-summary.mjs';
test('summary reuses only the current revision, collapses scans, and deep validation always scans',async()=>{
 let revision=1,scans=0,clock=0;
 const query=async()=>({rows:[{revision:String(revision)}]}),load=async()=>{scans++;await new Promise(r=>setTimeout(r,5));return {rows:[{decisions:revision}]};};
 const summary=revisionSummary({ttl:60,now:()=>clock});
 const results=await Promise.all([summary(query,load),summary(query,load),summary(query,load)]);
 assert.equal(scans,1);assert.deepEqual(results[0],results[1]);
 results[0].rows[0].decisions=999;assert.equal((await summary(query,load)).rows[0].decisions,1);
 for(const change of ['eligibility','exclusion','removal','rating','policy','activation']){
   revision++;assert.equal((await summary(query,load)).rows[0].decisions,revision,change);
 }
 assert.equal(scans,7);await summary(query,load,{deep:true});assert.equal(scans,8);
 clock=61;await summary(query,load);assert.equal(scans,9);
});
test('summary rejects concurrent revision changes and does not cache failed scans',async()=>{
 let revision=1,calls=0;const query=async()=>({rows:[{revision:String(revision)}]}),summary=revisionSummary();
 await assert.rejects(summary(query,async()=>{revision++;return []; }),{status:503});
 await assert.rejects(summary(query,async()=>{calls++;throw Error('scan failed');}),/scan failed/);
 await summary(query,async()=>{calls++;return [];});assert.equal(calls,2);
});
