import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gradeDraftRunPick} from '../draft-run.mjs';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/draft-run/scoring-golden.json','utf8'));
test('fixture inventory identifies the reviewed real corpus inputs',()=>{
  const source=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
  const fixture=JSON.parse(fs.readFileSync('tests/fixtures/draft-run/catalog.json','utf8'));
  assert.equal(fixture.corpus_version,source.corpus_version);
  assert.deepEqual(fixture.sets.map(s=>[s.id,s.source_sha256]),source.sets.map(s=>[s.id,s.sha256]));
});
test('real opening decision preserves frozen accepted scores without recomputing expectations',()=>{
  for(const {id,score} of fixture.expected)assert.equal(gradeDraftRunPick(fixture.puzzle,id).score,score,id);
  assert.equal(fixture.expected.find(c=>c.id===fixture.puzzle.historical_pick_id).score,100);
});
