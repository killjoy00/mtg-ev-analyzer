import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ids=text=>new Set([...text.matchAll(/'([a-z0-9-]+)'/g)].map(match=>match[1]));

test('complete import verification exempts exactly the importer frozen sets',()=>{
  const importer=read('scripts/import_all_trophies.py');
  // Before #553 the importer names them LEGACY_SCHEMA_SETS; afterwards HISTORICAL_FROZEN_SETS.
  const python=importer.match(/HISTORICAL_FROZEN_SETS = frozenset\(\{([^}]*)\}\)/)||importer.match(/LEGACY_SCHEMA_SETS = \{([^}]*)\}/);
  assert.ok(python,'importer frozen-set declaration not found');
  const verifier=read('scripts/verify-corpus-load.mjs');
  const javascript=verifier.match(/const HISTORICAL_FROZEN_SETS=new Set\(\[([^\]]*)\]\);/);
  assert.ok(javascript,'verify-corpus-load frozen-set declaration not found');
  assert.deepEqual([...ids(javascript[1])].sort(),[...ids(python[1])].sort());
  assert.match(verifier,/baseline\.sets\.filter\(s=>!HISTORICAL_FROZEN_SETS\.has\(s\.id\)&&!bySet\.has\(s\.id\)\)/);
});
