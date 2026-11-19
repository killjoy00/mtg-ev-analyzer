import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {corpusGameplayFingerprint} from '../scripts/corpus-gameplay-fingerprint.mjs';
import {gradeDraftRunPick} from '../draft-run.mjs';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/draft-run/scoring-golden.json','utf8'));
test('fixture inventory identifies the reviewed real corpus inputs',()=>{
  const source=JSON.parse(fs.readFileSync('corpus/draft-run/catalog.json','utf8'));
  const fixture=JSON.parse(fs.readFileSync('tests/fixtures/draft-run/catalog.json','utf8'));
  assert.equal(fixture.corpus_version,source.corpus_version);
  assert.equal(fixture.model_version,source.model_version);
  assert.deepEqual(fixture.sets.map(s=>s.id),source.sets.map(s=>s.id));
  for(const [index,set] of source.sets.entries()) {
    const pinned=fixture.sets[index];
    assert.deepEqual(pinned.source_archive,set.source_archive,set.id);
    assert.equal(pinned.evidence_sha256,set.evidence_sha256,set.id);
    const bytes=fs.readFileSync(`corpus/draft-run/${set.id}.json.gz`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),set.sha256,set.id);
    assert.match(pinned.source_sha256,/^[a-f0-9]{64}$/); // Original fixture provenance stays frozen.
    assert.equal(corpusGameplayFingerprint(JSON.parse(gunzipSync(bytes))),pinned.source_gameplay_sha256,set.id);
  }
});
test('gameplay fingerprint permits only card display edits and serialization differences',()=>{
  const original=[structuredClone(fixture.puzzle)],before=corpusGameplayFingerprint(original);
  const updated=structuredClone(original);
  for(const card of [...updated[0].candidates,...updated[0].prior_picks]) {
    Object.assign(card,{image_url:'https://example.test/new.jpg',mana_cost:'{1}',rarity:'rare',type_line:'Creature',display_faces:[]});
  }
  assert.equal(corpusGameplayFingerprint(updated),before);
  updated[0]=Object.fromEntries(Object.entries(updated[0]).reverse());
  assert.equal(corpusGameplayFingerprint(updated),before);
  for(const mutate of [
    row=>row.candidates[0].name+=' changed',
    row=>row.candidates[0].id+='-changed',
    row=>row.candidates[0].model_probability+=.001,
    row=>row.candidates.reverse(),
    row=>row.prior_picks.push(structuredClone(row.candidates[0])),
    row=>row.puzzle_id+='-changed',
    row=>row.historical_pick_id='changed',
    row=>row.source_draft_hash='changed',
    row=>row.image_url='outside-card-display-boundary',
  ]) {
    const changed=structuredClone(original);mutate(changed[0]);
    assert.notEqual(corpusGameplayFingerprint(changed),before);
  }
});
test('real opening decision preserves frozen accepted scores without recomputing expectations',()=>{
  for(const {id,score} of fixture.expected)assert.equal(gradeDraftRunPick(fixture.puzzle,id).score,score,id);
  assert.equal(fixture.expected.find(c=>c.id===fixture.puzzle.historical_pick_id).score,100);
});
