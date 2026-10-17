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

test('weekly boards retain best 3 scoring and daily boards retain plain averages',async()=>{
  const {LEADERBOARD_BEST_OF}=await import('../worker/draft-run-season.mjs');
  assert.deepEqual({...LEADERBOARD_BEST_OF},{week:3});
  let captured;
  await draftRunLeaderboardRows(async(sql,params)=>{captured={sql,params};return {rows:[]};},
    {start:'2026-10-12',end:'2026-10-18',environment:'mixed',bestOf:3});
  assert.equal(captured.params[7],3);
  assert.match(captured.sql,/row_number\(\) OVER\(PARTITION BY player_id ORDER BY score DESC,challenge_date\) best_rank/);
  assert.match(captured.sql,/sum\(score\) FILTER\(WHERE best_rank<=\$8::int\),0\)::numeric\/\$8::int/);
  await draftRunLeaderboardRows(async(sql,params)=>{captured={sql,params};return {rows:[]};},
    {start:'2026-10-18',end:'2026-10-18',environment:'mixed'});
  assert.equal(captured.params[7],null,'the daily board keeps its plain average');
});
