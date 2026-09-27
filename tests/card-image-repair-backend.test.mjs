import test from 'node:test';
import assert from 'node:assert/strict';
import {repairBackendImages} from '../scripts/repair_card_backend_image.mjs';

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
    if(body.action==='refresh-image-page')return {
      set_id:body.setId,
      mapping_entries:body.mapping.length,
      puzzles:1,
      updated_puzzles:1,
      updated_cards:1,
      next_after:null,
      done:true,
    };
    return {normalized:[{set_id:body.setIds[0],puzzles:1,missing_images:0}]};
  };
  await repairBackendImages(dev,{report,request});
  const pages=calls.filter(call=>call.body.action==='refresh-image-page');
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
      puzzles:1,
      updated_puzzles:0,
      updated_cards:0,
      next_after:null,
      done:true,
    };
  };
  await repairBackendImages(dev,{report:oneSet,request:clean,verify:true});
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'refresh-image-page');
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
    };
  };
  const run=async()=>{
    await repairBackendImages(dev,{report:oneSet,request});
    await repairBackendImages(prod,{report:oneSet,request});
  };
  await assert.rejects(run(),/development failed/);
  assert.deepEqual(bases,[dev]);
});
