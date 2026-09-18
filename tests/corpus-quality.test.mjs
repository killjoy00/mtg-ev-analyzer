import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusGates,CORPUS_TRANSITIONS} from '../corpus-quality.mjs';
import {handleAdmin} from '../worker/measurement-admin.mjs';
import {handleCorpusAdmin} from '../worker/corpus-admin.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
const healthy={archiveValid:true,versionValid:true,qualifiedTrophies:80,usablePuzzles:500,minimumPickBandSources:20,accountingValid:true,brokenTrajectories:0,qualifiedExclusionRate:.1,metadataCoverage:1,imageCoverage:1,invalidSupport:0,validation:{heldout:true,examples:500,logLoss:1.5,top1:.5,meanRank:2,calibrationError:.05}};
test('publication fails closed on missing evidence and exposes every gate',()=>{
 assert.equal(corpusGates(healthy).ready,true);assert.equal(corpusGates({}).ready,false);
 for(const [key,value] of Object.entries({archiveValid:false,versionValid:false,qualifiedTrophies:49,usablePuzzles:199,minimumPickBandSources:15,accountingValid:false,brokenTrajectories:1,qualifiedExclusionRate:.26,metadataCoverage:.99,imageCoverage:.99,invalidSupport:1,validation:{}}))assert.equal(corpusGates({...healthy,[key]:value}).ready,false,key);
 assert.equal(corpusGates({...healthy,qualifiedExclusionRate:.2,previousQualifiedExclusionRate:.05}).ready,false);
});
test('Corpus reuses authenticated admin authorization before mutation',async()=>{
 let calls=0;await assert.rejects(()=>handleAdmin(new Request('https://example.com/v1/admin/corpus'),async()=>{calls++;return {rows:[]};},async()=>({})),e=>e.status===401);assert.equal(calls,0);
 const request=new Request('https://example.com/v1/admin/corpus/hob/status',{method:'POST',headers:{'x-pack1-auth-session':'valid'}});
 await assert.rejects(()=>handleAdmin(request,async sql=>({rows:sql.includes('neon_auth.session')?[{id:'account'}]:[]}),async()=>({})),e=>e.status===403);
});
test('lifecycle rejects retired reactivation and stale clients; mutation is audited atomically',async()=>{
 assert.deepEqual(CORPUS_TRANSITIONS.Retired,[]);
 const request=new Request('https://example.com/v1/admin/corpus/hob/status',{method:'POST'});
 await assert.rejects(()=>handleCorpusAdmin(request,()=>{throw Error('must not query');},async()=>({oldStatus:'Retired',status:'Live'}),'admin'),e=>e.status===400);
 await assert.rejects(()=>handleCorpusAdmin(request,()=>{throw Error('must not query');},async()=>({oldStatus:'Candidate',status:'Live',corpusVersion:'old'}),'admin'),e=>e.status===409);
 let statement,params;const result=await handleCorpusAdmin(request,async(s,p)=>{statement=s;params=p;return {rows:[{set_id:'hob',status:'Paused'}]};},async()=>({oldStatus:'Live',status:'Paused',corpusVersion:DRAFT_RUN_CORPUS_VERSION,reason:'Review source'}),'admin');
 assert.equal(result.status,'Paused');assert.ok(statement.includes('INSERT INTO corpus_status_events'));assert.ok(statement.includes('md5(v.manifest::text)'));assert.ok(!/draft_run_(sessions|schedules)/.test(statement));assert.equal(params[4],'admin');
});
