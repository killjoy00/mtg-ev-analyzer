import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pickDue,runUnifiedTick} from '../scripts/pack-one-patreon-publisher.mjs';

const wed=new Date('2026-11-25T15:10:00Z'),thu=new Date('2026-11-26T15:10:00Z');
test('only the Wednesday and Thursday Chicago pick window is due, including DST',()=>{
 for(const now of [wed,thu,new Date('2026-07-08T14:00:00Z')])assert.equal(pickDue(now),true);
 for(const now of [new Date('2026-11-25T14:59:59Z'),new Date('2026-11-24T20:00:00Z'),new Date('2026-11-27T20:00:00Z'),new Date('2026-07-08T13:59:59Z')])assert.equal(pickDue(now),false);
});
test('all connected series share a single authenticated serial dispatcher and one bridge',async()=>{
 const calls=[];
 const call=async action=>{calls.push(action);return {pending:[]};};
 const bridge=async action=>{calls.push(action);return {status:'public-confirmed'};};
 const lane=name=>async deps=>{
  assert.equal(deps.call,call);assert.equal(deps.bridge,bridge);
  calls.push(name+'-begin');await Promise.resolve();calls.push(name+'-end');
  if(name==='recap')throw Error('private exception');
  return {status:'already-verified'};
 };
 const r=await runUnifiedTick({call,bridge,now:wed,recap:lane('recap'),season:lane('season'),lab:lane('lab')});
 assert.deepEqual(calls,['status','pick-tick','recap-begin','recap-end','season-begin','season-end','lab-begin','lab-end']);
 assert.deepEqual(r,{recap:'failed-closed',pick:'public-confirmed',season:'already-verified',lab:'already-verified'});
 assert.ok(!JSON.stringify(r).includes('private exception'));
});
test('revoked pairing stops all lanes, and unconnected modules never post',async()=>{
 const never=()=>assert.fail('must not publish');
 await assert.rejects(()=>runUnifiedTick({call:async()=>{throw Error('revoked');},bridge:never,now:wed,recap:never,season:never,lab:never}),/revoked/);
 const r=await runUnifiedTick({call:async()=>({pending:[]}),bridge:never,now:new Date('2026-11-30T18:00:00Z'),recap:async()=>({status:'outside-window'}),season:null,lab:null});
 assert.deepEqual(r,{recap:'outside-window',pick:'outside-window',season:'not-connected',lab:'not-connected'});
});
test('one packaged desktop entry, one shared lock and legacy auto-start retirement',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const setup=read('scripts/patreon-desktop/weekly_setup.py');
 assert.match(setup,/legacy_lock = lock_legacy_instance\(\)/);
 assert.match(setup,/disable_legacy_automatic\(\)/);
 assert.match(setup,/winreg\.DeleteValue\(key, 'PackOnePatreon'\)/);
 assert.match(setup,/scripts\/pack-one-patreon-publisher\.mjs/);
 assert.match(read('scripts/package-weekly-windows.mjs'),/const entry='scripts\/pack-one-patreon-publisher\.mjs'/);
 assert.doesNotMatch(read('.github/workflows/patreon-desktop.yml'),/gh release create/);
});
