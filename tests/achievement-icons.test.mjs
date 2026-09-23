import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {achievementIconIds,achievementMark} from '../achievement-icons.mjs';

const worker=await readFile(new URL('../worker/growth-function.js',import.meta.url),'utf8');
const start=worker.indexOf('function buildAchievements');
const end=worker.indexOf('\nasync function dailyHistoryFor',start);
const section=worker.slice(start,end);
const achievementIds=[...section.matchAll(/(?:countAchievement|flagAchievement)\('([^']+)'/g)].map(match=>match[1]);

test('every achievement has one registered badge icon',()=>{
  assert.ok(start>=0&&end>start,'achievement builder must be discoverable');
  assert.deepEqual([...new Set(achievementIds)].sort(),[...achievementIconIds].sort());
});

test('achievement badge markup is accessible and deterministic',()=>{
  for(const id of achievementIconIds){
    const markup=achievementMark(id);
    assert.match(markup,new RegExp('data-achievement-mark="'+id+'"'));
    assert.match(markup,/<svg /);
    assert.match(markup,/role="img"/);
    const decorative=achievementMark(id,{decorative:true,compact:true});
    assert.match(decorative,/aria-hidden="true"/);
    assert.match(decorative,/ compact"/);
  }
  assert.equal(achievementMark('not-real'),'');
});
