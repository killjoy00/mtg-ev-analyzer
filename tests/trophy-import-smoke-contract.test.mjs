import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTrophyImport} from './trophy-import-http-smoke.mjs';
import {DRAFT_RUN_LENGTH,DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {DRAFT_RUN_DIFFICULTY_VERSION} from '../draft-run-difficulty.mjs';
import {runPickWindows} from '../draft-run.mjs';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};

test('the import/image HTTP gate completes exactly eight picks in each environment',async()=>{
  let state,serial=0;
  const picks={mixed:0,'powered-cube':0},friends=[];
  const card={id:'card',image_url:'https://example.test/card.jpg'};
  const puzzle=(environment,round)=>{
    const pick=runPickWindows(environment)[round][0];
    return {puzzle_id:String(++serial),pack_number:1,pick_number:pick,set_id:environment==='mixed'?'msh':environment,candidates:[card],prior_picks:Array.from({length:pick-1},()=>card)};
  };
  await verifyTrophyImport('https://br-twilight-hill-ayffyd2b-draftrunapi.compute.c-5.us-east-2.aws.neon.tech',{
    log:()=>{},fetcher:async(url,options)=>{
      const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;
      if(path==='/health')return Response.json({sets:catalog.sets.length,expansion_sets:catalog.sets.length-1,puzzles:1000000});
      if(path==='/v1/session')return Response.json({token:'qa-token'});
      if(path==='/v1/runs') {
        assert.equal(body.qa,true);
        if(body.challenge){friends.push(state.environment);return Response.json({...state,current:state.answers[0].puzzle});}
        state={id:'run',environment:body.environment,round:1,revision:0,run_length:DRAFT_RUN_LENGTH,selection_version:DRAFT_RUN_SELECTION_VERSION,difficulty_version:DRAFT_RUN_DIFFICULTY_VERSION,answers:[],complete:false,current:puzzle(body.environment,0)};
      } else if(path.endsWith('/reroll'))state.current=puzzle(state.environment,0);
      else if(path.endsWith('/pick')) {
        assert.equal(body.round,picks[state.environment]++);
        assert.ok(body.round<DRAFT_RUN_LENGTH,'Never submit a ninth pick after completion');
        state.answers.push({score:100,puzzle:state.current});
        state.complete=state.answers.length===DRAFT_RUN_LENGTH;
        state.current=state.complete?null:puzzle(state.environment,state.answers.length);
        state.round++;state.revision++;if(state.complete)state.score=100;
      } else if(path.endsWith('/share'))return Response.json({id:'challenge'});
      else throw Error('Unexpected HTTP route '+path);
      return Response.json(state);
    },
  });
  assert.deepEqual(picks,{mixed:8,'powered-cube':8});
  assert.deepEqual(friends,['mixed','powered-cube']);
});
