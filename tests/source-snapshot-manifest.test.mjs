import test from 'node:test';
import assert from 'node:assert/strict';
import {sameSourceSnapshotManifest} from '../scripts/source-snapshot-manifest.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';

// PostgreSQL jsonb returns object keys shortest first, then bytewise.
const jsonbOrder=value=>Array.isArray(value)?value.map(jsonbOrder):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,jsonbOrder(value[k])])):value;

const built={full_import:{id:'fra',import_version:'v1',corpus_version:DRAFT_RUN_CORPUS_VERSION,
  source_snapshot_id:'a'.repeat(64),schema_version:'premier-modern-skill-buckets-v1',input_signature:'sig',
  source_archive:{url:'https://example.test/draft.csv.gz',etag:'"e-7"',sha256:'b'.repeat(64),compressed_bytes:56648372},
  holdout:'5-fold by draft_id',puzzle_file:'puzzles.jsonl.gz',puzzle_file_sha256:'c'.repeat(64),seconds:1357}};

test('a manifest read back from jsonb matches the one that was inserted',()=>{
  const stored=jsonbOrder(built);
  assert.notEqual(JSON.stringify(stored),JSON.stringify(built),'fixture must reproduce the jsonb key reordering');
  assert.equal(sameSourceSnapshotManifest(stored,JSON.stringify(built)),true);
  assert.equal(sameSourceSnapshotManifest(JSON.stringify(stored),built),true);
});

test('a rebuild of the same snapshot differs only in build time',()=>{
  const rebuilt={full_import:{...built.full_import,seconds:1622}};
  assert.equal(sameSourceSnapshotManifest(jsonbOrder(built),rebuilt),true);
});

test('any identifying difference still refuses the snapshot',()=>{
  assert.equal(sameSourceSnapshotManifest(built,{full_import:{...built.full_import,puzzle_file_sha256:'d'.repeat(64)}}),false);
  assert.equal(sameSourceSnapshotManifest(built,{full_import:{...built.full_import,source_archive:{...built.full_import.source_archive,etag:'"e-8"'}}}),false);
  assert.equal(sameSourceSnapshotManifest(null,built),false);
  assert.equal(sameSourceSnapshotManifest({},built),false);
});
