import test from 'node:test';
import assert from 'node:assert/strict';
import {registeredImageEnvironment,imageEnvironments,imageInventory,normalizeResolvedImageMarkers} from '../worker/trophy-import.mjs';
import {collectServedInventory,servedNames} from '../scripts/collect_served_card_inventory.mjs';
import {refreshBackendImages,propagationSetIds} from '../scripts/refresh_card_backend_images.mjs';

// FRA is a trophy-only environment: Live in the serving policy, absent from the
// replay catalog. KTK is a catalog environment.
const backend=({policy={fra:'Live'},present=new Set(['ktk','fra']),names={ktk:['Siege Rhino'],fra:['Countersculpt']}}={})=>{
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('FROM draft_run_environment_policy WHERE set_id=$1'))return {rows:policy[params[0]]&&['Live','Candidate'].includes(policy[params[0]])?[{}]:[]};
    if(sql.includes('FROM draft_run_environment_policy'))return {rows:Object.entries(policy).filter(([,s])=>['Live','Candidate'].includes(s)).map(([set_id,status])=>({set_id,status}))};
    if(sql.includes('WITH page AS'))return {rows:[{puzzles:1,last_puzzle_id:'p1',names:names[params[0]]||[]}]};
    if(sql.includes('SELECT 1 FROM draft_run_verified_puzzles'))return {rows:present.has(params[0])?[{}]:[]};
    throw Error('unexpected SQL: '+sql.slice(0,80));
  };
  return {query,calls};
};

test('environments outside the replay catalog are registered only through the serving policy',async()=>{
  const {query}=backend();
  assert.equal(await registeredImageEnvironment(query,'ktk'),true);
  assert.equal(await registeredImageEnvironment(query,'fra'),true);
  assert.equal(await registeredImageEnvironment(backend({policy:{fra:'Retired'}}).query,'fra'),false);
  assert.equal(await registeredImageEnvironment(query,'zzz'),false);
  assert.equal(await registeredImageEnvironment(query,"x'; drop"),false);
});

test('served inventory covers every served card of an environment, including FRA',async()=>{
  const {query,calls}=backend();
  const page=await imageInventory(query,'fra');
  const scanCall=calls.find(c=>c.sql.includes('WITH page AS'));
  assert.deepEqual(page,{set_id:'fra',corpus_version:scanCall.params[1],names:['Countersculpt'],puzzles:1,done:true,next_after:null});
  // Each request is bounded: a cursor and a page size, never a whole-environment scan.
  assert.equal(scanCall.params[2],'');
  assert.ok(Number.isInteger(scanCall.params[3])&&scanCall.params[3]<=5000);
  assert.match(scanCall.sql,/p\.puzzle_id>\$3/);
  assert.match(scanCall.sql,/LIMIT \$4/);
  const scan=scanCall.sql;
  assert.match(scan,/prior_picks/);
  assert.match(scan,/c\.status='Live'/);
  await assert.rejects(imageInventory(backend({policy:{}}).query,'fra'),/registered environment/);
});

test('image environments list catalog and policy environments that serve puzzles',async()=>{
  const {environments}=await imageEnvironments(backend().query);
  const fra=environments.find(e=>e.set_id==='fra');
  assert.deepEqual(fra,{set_id:'fra',catalog:false,status:'Live'});
  assert.equal(environments.find(e=>e.set_id==='ktk').catalog,true);
  // A catalog environment with no current puzzles is not listed.
  assert.equal(environments.some(e=>e.set_id==='mom'),false);
});

test('image-marker normalization accepts registered non-catalog environments only',async()=>{
  await assert.rejects(normalizeResolvedImageMarkers(backend({policy:{}}).query,['fra']),/registered environments/);
  await assert.rejects(normalizeResolvedImageMarkers(backend().query,['fra','fra']),/Invalid image-marker set list/);
});

test('the collector merges development and production inventories',async()=>{
  const responses={
   dev:{envs:[{set_id:'ktk',catalog:true,status:'Live'},{set_id:'fra',catalog:false,status:'Live'}],names:{ktk:['A'],fra:['F1']}},
   prod:{envs:[{set_id:'ktk',catalog:true,status:'Live'},{set_id:'fra',catalog:false,status:'Live'}],names:{ktk:['A','B'],fra:['F2']}},
  };
  const request=async(base,body)=>{
    const r=responses[base.includes('dev')?'dev':'prod'];
    if(body.action==='image-environments')return {corpus_version:'v',environments:r.envs};
    return {set_id:body.setId,corpus_version:'v',names:r.names[body.setId],done:true,next_after:null};
  };
  const inventory=await collectServedInventory(['https://dev','https://prod'],request);
  assert.deepEqual(inventory.environments.ktk.names,['A','B']);
  assert.deepEqual(inventory.environments.fra.names,['F1','F2']);
  assert.equal(inventory.environments.fra.catalog,false);
  await assert.rejects(collectServedInventory(['http://dev'],request),/HTTPS/);
  await assert.rejects(collectServedInventory(['https://dev'],async()=>({corpus_version:'v',environments:[]})),/Unexpected image environment listing/);
});

const propagation=({served={fra:{names:['Countersculpt']}},inventory={ktk:['Siege Rhino'],fra:['Countersculpt']}}={})=>{
  const calls=[];
  const request=async(base,body)=>{
    calls.push(body);
    if(body.action==='refresh-image-page-v2')return {set_id:body.setId,mapping_entries:body.mapping.length,puzzles:1,updated_puzzles:0,updated_cards:0,done:true,corpus_available:true};
    if(body.action==='image-inventory')return {set_id:body.setId,corpus_version:'v',names:inventory[body.setId],done:true,next_after:null};
    if(body.action==='normalize-image-markers')return {normalized:[{set_id:body.setIds[0],missing_images:0,puzzles:1}]};
    throw Error('unexpected action');
  };
  const mappings={ktk:[{name:'Siege Rhino',image_url:'https://k'}],fra:[{name:'Countersculpt',image_url:'https://f'}]};
  return {calls,run:()=>refreshBackendImages('https://api',{request,catalog:{sets:[{id:'ktk'}]},served,readMapping:sid=>mappings[sid]})};
};

test('propagation covers served-only environments and fails closed on unmapped served cards',async()=>{
  assert.deepEqual(propagationSetIds({sets:[{id:'ktk'}]},{fra:{},ktk:{}}),['ktk','fra']);
  const ok=propagation();
  const result=await ok.run();
  assert.deepEqual(result.refreshed.map(r=>r.set_id),['ktk','fra']);
  assert.deepEqual(result.normalized.map(r=>r.set_id),['ktk','fra']);
  const gap=propagation({inventory:{ktk:['Siege Rhino','Lightning Bolt'],fra:['Countersculpt']}});
  await assert.rejects(gap.run(),/ktk: 1 served cards have no card-image policy selection \(Lightning Bolt\)/);
  // Nothing is normalized after a coverage failure.
  assert.equal(gap.calls.some(c=>c.action==='normalize-image-markers'),false);
});

test('served names follow every inventory page and refuse a stuck cursor',async()=>{
  const pages={'':{names:['A','B'],done:false,next_after:'p2000'},p2000:{names:['B','C'],done:false,next_after:'p4000'},p4000:{names:['D'],done:true,next_after:null}};
  const seen=[];
  const request=async(base,body)=>{seen.push(body.after);return {set_id:body.setId,corpus_version:'v',...pages[body.after]};};
  assert.deepEqual(await servedNames(request,'https://api','dmu'),{corpus_version:'v',names:['A','B','C','D']});
  assert.deepEqual(seen,['','p2000','p4000']);
  const stuck=async(base,body)=>({set_id:body.setId,corpus_version:'v',names:['A'],done:false,next_after:body.after||'p1'});
  await assert.rejects(servedNames(stuck,'https://api','dmu'),/cursor did not advance/);
  const versionChange=async(base,body)=>({set_id:body.setId,corpus_version:body.after?'w':'v',names:['A'],done:!!body.after,next_after:'p1'});
  await assert.rejects(servedNames(versionChange,'https://api','dmu'),/changed corpus version/);
});
