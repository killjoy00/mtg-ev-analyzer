import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {repairBackendImages,runBackendRepair} from '../scripts/repair_card_backend_image.mjs';

const dev='https://br-twilight-hill-ayffyd2b-draftrunapi.compute.c-5.us-east-2.aws.neon.tech';
const prod='https://br-orange-feather-ayps8kep-draftrunapi.compute.c-5.us-east-2.aws.neon.tech';
const report={
  environments:['powered-cube','dsk'],
  environment_results:{
    'powered-cube':{
      mapping:{
        name:'Titania, Protector of Argoth',
        image_url:'https://img/titania.jpg',
        mana_cost:'{3}{G}{G}',
        rarity:'mythic',
        type_line:'Legendary Creature — Elemental',
      },
    },
    dsk:{
      mapping:{
        name:'Alpha',
        image_url:'https://img/alpha.jpg',
        mana_cost:'{1}',
        rarity:'common',
        type_line:'Creature',
      },
    },
  },
};

test('targeted backend touches only listed setIds with one-entry mappings',async()=>{
  const calls=[];
  const request=async(base,body)=>{
    calls.push({base,body});
    if(body.action==='refresh-image-page-v2')return {
      set_id:body.setId,
      mapping_entries:body.mapping.length,
      puzzles:1,
      updated_puzzles:1,
      updated_cards:1,
      next_after:null,
      done:true,
      corpus_available:true,
    };
    return {normalized:[{set_id:body.setIds[0],puzzles:1,missing_images:0}]};
  };
  await repairBackendImages(dev,{report,request});
  const pages=calls.filter(call=>call.body.action==='refresh-image-page-v2');
  assert.deepEqual(pages.map(call=>call.body.setId),['powered-cube','dsk']);
  assert.ok(pages.every(call=>call.body.mapping.length===1));
  assert.ok(calls.every(call=>!['vow','mid','ktk'].includes(call.body.setId)));
  assert.deepEqual(
    calls.filter(call=>call.body.action==='normalize-image-markers').map(call=>call.body.setIds),
    [['powered-cube'],['dsk']],
  );
});

test('verification pass requires zero updated cards on every page',async()=>{
  const oneSet={
    environments:['powered-cube'],
    environment_results:{'powered-cube':report.environment_results['powered-cube']},
  };
  const dirty=async(_base,body)=>({
    set_id:body.setId,
    mapping_entries:1,
    puzzles:1,
    updated_puzzles:1,
    updated_cards:1,
    next_after:null,
    done:true,
    corpus_available:true,
  });
  await assert.rejects(
    repairBackendImages(dev,{report:oneSet,request:dirty,verify:true}),
    /verification found 1 updates/,
  );

  const calls=[];
  const clean=async(_base,body)=>{
    calls.push(body);
    return {
      set_id:body.setId,
      mapping_entries:1,
      puzzles:0,
      updated_puzzles:0,
      updated_cards:0,
      next_after:null,
      done:true,
      corpus_available:true,
    };
  };
  await repairBackendImages(dev,{report:oneSet,request:clean,verify:true});
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'refresh-image-page-v2');
});

test('development failure prevents the caller from touching production',async()=>{
  const bases=[];
  const oneSet={
    environments:['powered-cube'],
    environment_results:{'powered-cube':report.environment_results['powered-cube']},
  };
  const request=async(base,body)=>{
    bases.push(base);
    if(base===dev)throw new Error('development failed');
    return {
      set_id:body.setId,
      mapping_entries:1,
      puzzles:1,
      updated_puzzles:0,
      updated_cards:0,
      next_after:null,
      done:true,
      corpus_available:true,
    };
  };
  const run=async()=>{
    await repairBackendImages(dev,{report:oneSet,request});
    await repairBackendImages(prod,{report:oneSet,request});
  };
  await assert.rejects(run(),/development failed/);
  assert.deepEqual(bases,[dev]);
});


test('backend diagnostics retain page counts and verification outcomes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'card-image-repair-'));
  const oneSet={
    environments:['powered-cube'],
    environment_results:{'powered-cube':report.environment_results['powered-cube']},
  };
  try {
    const successPath=path.join(dir,'development-verify.json');
    const clean=async(_base,body)=>({
      set_id:body.setId,
      mapping_entries:1,
      puzzles:3,
      updated_puzzles:0,
      updated_cards:0,
      next_after:null,
      done:true,
      corpus_available:true,
    });
    await runBackendRepair(dev,{
      report:oneSet,
      request:clean,
      verify:true,
      diagnosticsPath:successPath,
      stage:'development-verify',
    });
    const success=JSON.parse(fs.readFileSync(successPath,'utf8'));
    assert.equal(success.status,'success');
    assert.equal(success.stage,'development-verify');
    assert.equal(success.verify,true);
    assert.equal(success.results[0].pages,1);
    assert.equal(success.results[0].puzzles,3);
    assert.equal(success.results[0].verified_zero_updates,true);
    assert.equal(success.events[0].phase,'page');

    const failurePath=path.join(dir,'production-verify.json');
    const dirty=async(_base,body)=>({
      set_id:body.setId,
      mapping_entries:1,
      puzzles:2,
      updated_puzzles:1,
      updated_cards:1,
      next_after:null,
      done:true,
      corpus_available:true,
    });
    await assert.rejects(
      runBackendRepair(prod,{
        report:oneSet,
        request:dirty,
        verify:true,
        diagnosticsPath:failurePath,
        stage:'production-verify',
      }),
      /verification found 1 updates/,
    );
    const failure=JSON.parse(fs.readFileSync(failurePath,'utf8'));
    assert.equal(failure.status,'error');
    assert.equal(failure.stage,'production-verify');
    assert.match(failure.error,/verification found 1 updates/);
    assert.equal(failure.events[0].updated_cards,1);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
