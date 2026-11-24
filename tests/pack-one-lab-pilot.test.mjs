import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readArchive,renderDraft,renderChart,provenance} from '../research/pack-one-lab/pilot.mjs';
const raw=readFileSync(new URL('../'+provenance.path,import.meta.url));
const input=JSON.parse(raw);
const registry=JSON.parse(readFileSync(new URL('../research/pack-one-lab/registry.json',import.meta.url)));

test('pinned public aggregate and deterministic metrics',()=>{
  assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),provenance.blob);
  const [s,c]=readArchive(input);
  assert.deepEqual(s.metrics.map(m=>[m.numerator,m.denominator,m.percent]),[[13513,28424,47.5],[14911,28424,52.5]]);
  assert.deepEqual(c.metrics.map(m=>[m.numerator,m.denominator,m.percent]),[[3984,21545,18.5],[17561,21545,81.5]]);
  assert.equal(c.context.all_repeated_groups,26258);
  assert.equal(s.status,'draft-only');
  assert.deepEqual(readArchive(input),readArchive(input));
});

test('registry makes planned work explicit',()=>{
  assert.equal(registry.templates.length,27);
  assert.equal(new Set(registry.templates.map(t=>t.id)).size,27);
  const implemented=registry.templates.filter(t=>t.status.startsWith('implemented:')).map(t=>t.id);
  assert.deepEqual(implemented,readArchive(input).map(p=>p.id));
  for(const t of registry.templates)for(const k of ['series','question','source','unit','method','requirements'])assert.ok(t[k]);
});

test('invalid source, counts, units and small samples fail closed',()=>{
  for(const mutate of [
    x=>{x.set='wrong';},
    x=>{x.source_sha256.draft='wrong';},
    x=>{x.cohort_cutoff=NaN;},
    x=>{x.splash_sensitivity.games_with_splash=x.splash_sensitivity.games+1;},
    x=>{x.splash_sensitivity.games=0;},
    x=>{x.copy_labels.repeated_groups_ever_played=99;},
    x=>{x.copy_labels.groups_with_fewer_observed_deck_copies=-1;},
    x=>{x.copy_labels.drafts_with_game_observations=x.qualified_training_drafts+1;},
    x=>{x.copy_labels.copies_above_maximum_observed_deck_count=1;}
  ]){
    const x=structuredClone(input);mutate(x);assert.throws(()=>readArchive(x),/lab-/);
  }
});

test('article and chart agree with computed facts and expose limitations',()=>{
  for(const p of readArchive(input)){
    const article=renderDraft(p),chart=renderChart(p);
    assert.ok(article.startsWith('# '+p.headline));
    assert.ok(article.includes(p.metrics[0].percent.toFixed(1)+'%'));
    assert.ok(article.includes(p.metrics[1].percent.toFixed(1)+'%'));
    assert.ok(article.includes(p.provenance.method));
    assert.ok(article.includes('CC BY 4.0'));
    for(const limit of p.limitations)assert.ok(article.includes(limit));
    assert.ok(chart.includes('<svg '));assert.ok(chart.includes(p.metrics[0].percent.toFixed(1)+'%'));
    assert.ok(chart.includes(p.metrics[1].percent.toFixed(1)+'%'));
    assert.equal(renderDraft(p),article);assert.equal(renderChart(p),chart);
    const words=article.trim().split(/\s+/).length;
    assert.ok(words>=300&&words<=500);
  }
});
