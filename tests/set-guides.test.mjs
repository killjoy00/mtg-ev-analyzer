import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GUIDE_IDS,hasSetGuide,setGuidePath,renderSetGuide,renderResults,loadSetGuide} from '../set-guides.mjs';

test('published guides have complete, sourced content and valid comparable snapshots',async()=>{
  const names=JSON.parse(await readFile('data/set-display-names.json','utf8')).names;
  const sitemap=await readFile('sitemap.xml','utf8');
  for(const id of GUIDE_IDS){
    const guide=JSON.parse(await readFile(`sets/guides/data/${id}.json`,'utf8'));
    assert.equal(guide.id,id);assert.equal(guide.name,names[id]);
    assert.equal(guide.notes.length,3);assert.ok(guide.notes.every(n=>n.length>10));
    assert.ok(guide.archetypes.length>=5);assert.ok(guide.sources.length);
    assert.ok(Number.isFinite(Date.parse(guide.reviewedAt)));
    for(const source of guide.sources)assert.equal(new URL(source.url).protocol,'https:');
    const seen=new Set();
    for(const a of guide.archetypes){assert.match(a.colors,/^[WUBRG]{1,3}$/);assert.ok(a.name&&a.plan&&a.detail);assert.ok(!seen.has(a.colors));seen.add(a.colors);}
    if(guide.results){
      const r=guide.results;assert.equal(r.format,'PremierDraft');assert.equal(r.period,'ALL_TIME');assert.equal(r.userGroup,'all');assert.equal(r.splashes,false);
      assert.equal(r.rows.length,10);assert.equal(new Set(r.rows.map(x=>[...x.colors].sort().join(''))).size,10);
      assert.ok(Number.isFinite(Date.parse(r.retrievedAt)));
      assert.equal(new URL(r.sourceUrl).hostname,'www.17lands.com');
      for(const row of [...r.rows,r.baseline]){assert.ok(Number.isInteger(row.games)&&row.games>=0);assert.ok(Number.isInteger(row.wins)&&row.wins>=0&&row.wins<=row.games);}
      for(const row of r.rows)assert.equal(row.colors.length,r.colorCount);
      assert.equal(r.baseline.games,r.rows.reduce((sum,row)=>sum+row.games,0));assert.equal(r.baseline.wins,r.rows.reduce((sum,row)=>sum+row.wins,0));
    }else assert.ok(guide.resultsNote);
    const html=await readFile(`sets/${id}/guide/index.html`,'utf8');
    assert.ok(html.includes(renderSetGuide(guide)),`${id} generated page matches reviewed JSON`);
    assert.ok(sitemap.includes(`https://packone.pro${setGuidePath(id)}`));
  }
});

test('results suppress small samples and separate themes from observed deck colors',()=>{
  const guide={archetypes:[],results:{formatLabel:'Premier Draft (BO1)',colorCount:2,retrievedAt:'2026-10-18',rows:[{colors:'WU',wins:499,games:499},{colors:'BG',wins:280,games:500}],sourceUrl:'https://www.17lands.com/deck_color_data'}};
  const html=renderResults(guide);
  assert.match(html,/Black–Green<\/strong> has the highest/);assert.doesNotMatch(html,/100\.0%/);assert.match(html,/56\.0%/);assert.match(html,/not confirmed archetype classifications/);
});

test('unknown sets never publish dead links or fetch arbitrary paths',async()=>{
  assert.equal(hasSetGuide('ECL'),true);assert.equal(setGuidePath('ECL'),'/sets/ecl/guide/');assert.equal(setGuidePath('../unknown'),null);
  await assert.rejects(loadSetGuide('../unknown'),/No guide/);
});
