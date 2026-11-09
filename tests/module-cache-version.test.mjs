import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A version suffix is part of an ES module's identity. The same file must
// never be imported with mixed ?v= values (or with and without a suffix).
// Audit every route capable of loading the account and profile module graph.
const routes=[
  'bootstrap.mjs','growth.mjs','daily-home.mjs','home-today.mjs',
  'draft-run-product.mjs','draft-run.mjs','profile-product.mjs',
  'progression.mjs','daily-reminder-settings.mjs','my-pack-one.mjs',
  'my-pack-insights.mjs','trophy-deck-dialog.mjs','practice-page.mjs',
  'patreon-page.mjs','practice/index.html','patreon/index.html',
];
const expected={
  'growth.mjs':'?v=32',
  'growth-api.mjs':'',
  'profile-product.mjs':'?v=24',
  'draft-run-product.mjs':'?v=38',
  'today-status.mjs':'',
  'share-cards.mjs':'',
  'draft-run-feedback.mjs':'',
  'card-viewer.mjs':'?v=2',
};

test('browser module identities are canonical across profile, practice and Daily routes',async()=>{
  const contents=await Promise.all(routes.map(route=>readFile(route,'utf8')));
  const references=new Map(Object.keys(expected).map(name=>[name,[]]));
  for(let i=0;i<routes.length;i++){
    for(const match of contents[i].matchAll(/['"](?:\.\.?\/|\/)([\w./-]+\.mjs)(\?v=\d+)?['"]/g)){
      const name=match[1].split('/').at(-1);
      if(references.has(name))references.get(name).push({route:routes[i],suffix:match[2]||''});
    }
  }
  for(const [name,suffix] of Object.entries(expected)){
    const refs=references.get(name);
    assert.ok(refs.length>0,name+' must be covered');
    for(const ref of refs)assert.equal(ref.suffix,suffix,name+' has a distinct browser module in '+ref.route);
  }
});

test('main entrypoint and practice preloads keep matching release cache versions',async()=>{
  const index=await readFile('index.html','utf8');
  const practice=await readFile('practice/index.html','utf8');
  const main=index.match(/bootstrap\.mjs(\?v=\d+)/)?.[1];
  const preload=practice.match(/bootstrap\.mjs(\?v=\d+)/)?.[1];
  assert.ok(main,'main bootstrap must be release-versioned');
  assert.equal(preload,main,'preloading a different URL fetches a second module');
});
