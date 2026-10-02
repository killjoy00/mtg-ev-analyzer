import test from 'node:test';
import assert from 'node:assert/strict';
import {draftRunLeaderboardRows} from '../worker/draft-run-season.mjs';
import {V5_CORPUS_VERSION,V5_CONTEXT_MODEL_VERSION,validateDraftRunPuzzle} from '../draft-run.mjs';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import versions from '../model-versions.json' with {type:'json'};

test('v5 standings exclude historical scores without deleting game history',async()=>{
  for(const environment of ['mixed','latest','powered-cube']) {
    for(const start of ['2000-01-01','2026-09-01','2026-09-28','2026-10-02']) {
      let captured;
      await draftRunLeaderboardRows(async(sql,params)=>{captured={sql,params};return {rows:[]};},
        {start,end:'2026-10-02',environment,corpusVersion:V5_CORPUS_VERSION});
      assert.match(captured.sql,/details_json->>'corpus_version'=\$7/);
      assert.equal(captured.params[6],V5_CORPUS_VERSION);
      assert.doesNotMatch(captured.sql,/DELETE|UPDATE/);
    }
  }
});
test('v4 retains its historical leaderboard behavior',async()=>{
  let params;
  await draftRunLeaderboardRows(async(_,p)=>{params=p;return {rows:[]};},
    {start:'2000-01-01',end:'2026-10-02',environment:'mixed',corpusVersion:versions.v4.corpus_version});
  assert.equal(params[6],null);
});

test('a new corpus rejects old or missing model labels while historical payloads still validate',()=>{
  const historical=JSON.parse(gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/blb.json.gz',import.meta.url))))[0];
  assert.equal(validateDraftRunPuzzle(historical),true);
  const candidate={...historical,corpus_version:V5_CORPUS_VERSION,model_version:V5_CONTEXT_MODEL_VERSION};
  assert.equal(validateDraftRunPuzzle(candidate,V5_CORPUS_VERSION),true);
  for(const model_version of [versions.v4.model_version,undefined])
    assert.equal(validateDraftRunPuzzle({...candidate,model_version},V5_CORPUS_VERSION),false);
});
