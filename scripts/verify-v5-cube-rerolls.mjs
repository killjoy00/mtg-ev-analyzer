import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {
  DRAFT_RUN_CORPUS_VERSION,
  V5_CORPUS_VERSION,
  V5_CONTEXT_MODEL_VERSION,
  POWERED_CUBE_ENVIRONMENT,
  draftRunDifficulty,
  draftRunRerollDistance,
  interestingDraftRunPuzzle,
  runPickWindows,
} from '../draft-run.mjs';
import {meetsServingQuality} from '../serving-quality.mjs';
import {DRAFT_RUN_SELECTION_VERSION,earlyRoundsForSelection} from '../draft-run-policy.mjs';
import {MAX_REROLL_RATING_DELTA} from '../draft-run-difficulty.mjs';
import {CUBE_TRADITIONAL_V5_COMPONENT_VERSION} from '../corpus-components.mjs';

const RUNTIME_CANDIDATE_LIMIT=20;
const OTHER_RUN_SOURCES=7;
const REQUIRED_REPLACEMENT_RESERVE=OTHER_RUN_SOURCES+1;
const POSSIBLE_FIRST_REPLACEMENTS=RUNTIME_CANDIDATE_LIMIT+OTHER_RUN_SOURCES;
const MAX_REROLL_DISTANCE=0.16;

function distanceFromMetrics(a,b) {
  const pickDistance=Math.abs(a.pickNumber-b.pickNumber)/3;
  const countDistance=Math.abs(a.candidateCount-b.candidateCount)/Math.max(1,a.candidateCount,b.candidateCount);
  const gapDistance=Math.abs(a.topGap-b.topGap);
  const entropyDistance=Math.abs(a.entropy-b.entropy);
  const poolDistance=Math.abs(a.priorPoolSize-b.priorPoolSize)/Math.max(1,a.priorPoolSize,b.priorPoolSize);
  return pickDistance*.35+countDistance*.15+gapDistance*.25+entropyDistance*.15+poolDistance*.10;
}

function comparable(a,b,anchor) {
  return b.metric.band===a.metric.band && b.metric.band===anchor.band &&
    Math.abs(b.metric.rating-a.metric.rating)<=MAX_REROLL_RATING_DELTA &&
    Math.abs(b.metric.rating-anchor.rating)<=MAX_REROLL_RATING_DELTA &&
    Number.isFinite(distanceFromMetrics(a.metric,b.metric)) &&
    distanceFromMetrics(a.metric,b.metric)<=MAX_REROLL_DISTANCE;
}

export function validateCubeRerollSlack(rows,{requireV5=true}={}) {
  assert.ok(Array.isArray(rows)&&rows.length,'Full Cube candidate rows are required.');
  const windows=runPickWindows(POWERED_CUBE_ENVIRONMENT,DRAFT_RUN_SELECTION_VERSION);
  assert.deepEqual(windows,Array.from({length:8},(_,i)=>[i+2,i+2]),
    'Review the full-candidate Cube reroll proof when current Cube pick windows change.');

  if(requireV5) {
    assert.equal(DRAFT_RUN_CORPUS_VERSION,V5_CORPUS_VERSION,'V5 finalizer must validate from the v9 release tree.');
    assert.ok(rows.every(p=>p.set_id===POWERED_CUBE_ENVIRONMENT),'Candidate contains a non-Cube row.');
    assert.ok(rows.every(p=>p.model_version===V5_CONTEXT_MODEL_VERSION),'Candidate contains a non-v5 Cube model row.');
    const premier=rows.filter(p=>p.corpus_version===V5_CORPUS_VERSION);
    const traditional=rows.filter(p=>p.corpus_version===CUBE_TRADITIONAL_V5_COMPONENT_VERSION &&
      p.parent_corpus_version===V5_CORPUS_VERSION);
    assert.equal(premier.length+traditional.length,rows.length,'Candidate contains an unexpected Cube corpus/component version.');
    assert.ok(new Set(premier.map(p=>p.source_draft_hash)).size>300,
      'Expected the complete first-class Cube trophy snapshot, not the 300-seat replay baseline.');
    assert.ok(traditional.length>0,'Expected the admitted v5 Traditional Cube component in the serving-union proof.');
  }

  const groups=new Map();
  for(const puzzle of rows) {
    const round=Number(puzzle.pick_number)-2;
    if(round<0||round>=windows.length||!interestingDraftRunPuzzle(puzzle)||!meetsServingQuality(puzzle))continue;
    const metric=draftRunDifficulty(puzzle);
    if(round>=earlyRoundsForSelection(DRAFT_RUN_SELECTION_VERSION)&&metric.band==='easy')continue;
    const item={puzzle,metric};
    const key=`${puzzle.pick_number}:${metric.band}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }

  let selectable=0,checkedFirstReplacements=0,minFirst=Infinity,minSecond=Infinity;
  let distanceParityChecked=false;
  for(const [key,group] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    group.sort((a,b)=>a.puzzle.puzzle_id.localeCompare(b.puzzle.puzzle_id));
    assert.equal(new Set(group.map(x=>x.puzzle.source_draft_hash)).size,group.length,
      `${key}: more than one selectable puzzle uses the same source draft`);
    selectable+=group.length;

    const neighbors=new Map();
    for(const source of group) {
      const list=[];
      for(const candidate of group) {
        if(candidate===source||candidate.puzzle.source_draft_hash===source.puzzle.source_draft_hash)continue;
        if(!comparable(source,candidate,source.metric))continue;
        const distance=distanceFromMetrics(source.metric,candidate.metric);
        if(!distanceParityChecked) {
          assert.ok(Math.abs(distance-draftRunRerollDistance(source.puzzle,candidate.puzzle))<1e-12,
            'Offline Cube reroll distance drifted from the runtime selector.');
          distanceParityChecked=true;
        }
        list.push({candidate,distance});
      }
      list.sort((a,b)=>a.distance-b.distance||a.candidate.puzzle.puzzle_id.localeCompare(b.candidate.puzzle.puzzle_id));
      neighbors.set(source.puzzle.puzzle_id,list);
    }

    for(const source of group) {
      const first=neighbors.get(source.puzzle.puzzle_id);
      minFirst=Math.min(minFirst,first.length);
      assert.ok(first.length>=REQUIRED_REPLACEMENT_RESERVE,
        `${source.puzzle.puzzle_id}: only ${first.length} first Cube reroll sources remain at ${key}; need ${REQUIRED_REPLACEMENT_RESERVE} to survive the other seven run sources`);

      // Seven other run sources can disappear before the first reroll, so only
      // the first 20+7 candidates can ever enter the runtime's closest-20 set.
      for(const {candidate:replacement} of first.slice(0,POSSIBLE_FIRST_REPLACEMENTS)) {
        checkedFirstReplacements++;
        const second=neighbors.get(replacement.puzzle.puzzle_id).filter(({candidate})=>
          candidate.puzzle.source_draft_hash!==source.puzzle.source_draft_hash &&
          Math.abs(candidate.metric.rating-source.metric.rating)<=MAX_REROLL_RATING_DELTA);
        minSecond=Math.min(minSecond,second.length);
        assert.ok(second.length>=REQUIRED_REPLACEMENT_RESERVE,
          `${source.puzzle.puzzle_id} -> ${replacement.puzzle.puzzle_id}: only ${second.length} second Cube reroll sources remain at ${key}; need ${REQUIRED_REPLACEMENT_RESERVE} to survive the other seven run sources`);
      }
    }
  }
  assert.ok(selectable>0,'Full Cube candidate has no selectable current decisions.');
  return {
    rows:rows.length,
    sources:new Set(rows.map(p=>p.source_draft_hash)).size,
    premier_sources:new Set(rows.filter(p=>p.corpus_version===V5_CORPUS_VERSION).map(p=>p.source_draft_hash)).size,
    traditional_sources:new Set(rows.filter(p=>p.corpus_version===CUBE_TRADITIONAL_V5_COMPONENT_VERSION).map(p=>p.source_draft_hash)).size,
    selectable,
    checked_first_replacements:checkedFirstReplacements,
    min_first_sources:minFirst,
    min_second_sources:minSecond,
  };
}

function readJsonlGzip(file) {
  return gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const files=process.argv.slice(2);
  if(!files.length)throw Error('Usage: node scripts/verify-v5-cube-rerolls.mjs PREMIER_CUBE_PUZZLES_JSONL_GZ TRADITIONAL_CUBE_PUZZLES_JSONL_GZ');
  const report=validateCubeRerollSlack(files.flatMap(readJsonlGzip));
  console.log('V5_CUBE_REROLL_SLACK '+JSON.stringify(report));
}
