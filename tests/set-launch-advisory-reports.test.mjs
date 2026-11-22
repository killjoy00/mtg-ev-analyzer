import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSetSelection,reportSetSelection,formatSetSelectionReport} from '../scripts/report-set-selection.mjs';
import {recentSeasonRollover,formatSeasonRolloverReport} from '../scripts/report-season-rollover.mjs';

const snapshot={source_snapshot_id:'trksnapshot',lifecycle_status:'Candidate'};
const strength={version:'gih-shrunk-400-v1',sha256:'a'.repeat(64)};

test('new-set selection report is advisory even if feature coverage is incomplete',async()=>{
  const queries=[];
  const result=await reportSetSelection(async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('FROM corpus_source_snapshots'))return {rows:[snapshot]};
    if(sql.includes('FROM draft_run_schedules s'))return {rows:[{environment:'latest',day:'2026-11-23',selection_rule:'latest-stakes-v2',set_picks:8,total_picks:8}]};
    return {rows:[{total:800,scored:720,clear_easy:680}]};
  },'trk',{loadStrength:()=>strength});
  assert.equal(result.assessment,'older_selection_fallback_possible');
  assert.equal(result.advisory_only,true);
  assert.equal(result.strength_coverage_pct,90);
  assert.equal(result.clear_easy_coverage_pct,85);
  assert.equal(queries.length,3);
  assert.match(queries[1].sql,/source_snapshot_id=\$1/);
  assert.match(queries[1].sql,/f.strength_sha256=\$5/);
  assert.equal(queries[1].params[4],strength.sha256);
  assert.match(formatSetSelectionReport(result),/does not prevent release/);
  assert.equal(result.observed_today[0].set_picks,8);
  assert.equal(result.observed_today[0].actual_selection_rule,'latest-stakes-v2');
});

test('advisory report distinguishes clear-Easy fallback, no data and fully scored',()=>{
  const input={setId:'trk',snapshot,total:8,scored:8,clearEasy:7,strength};
  assert.equal(summarizeSetSelection(input).assessment,'clear_easy_fallback_possible');
  assert.equal(summarizeSetSelection({...input,clearEasy:8}).assessment,'fully_scored');
  assert.equal(summarizeSetSelection({...input,strength:null}).assessment,'no_strength_table');
  assert.equal(summarizeSetSelection({...input,snapshot:null}).assessment,'no_snapshot');
  assert.equal(summarizeSetSelection({...input,total:0}).assessment,'no_eligible_puzzles');
});

test('new season rollover reports all three board counts, not named standings',async()=>{
  const seen=[];
  const query=async(sql,args)=>{
    seen.push({sql,args});
    if(sql.includes('SELECT old.set_id outgoing_set'))return {rows:[{outgoing_set:'fra',incoming_set:'trk'}]};
    if(sql.includes('FROM draft_run_seasons old JOIN draft_run_seasons next'))return {rows:[{
      set_id:'fra',set_name:'Reality Fracture',start_date:'2026-10-01',end_date:'2026-11-20',
      next_set:'trk',captured_at:'2026-11-21T12:00:00Z',
    }]};
    if(sql.includes('WITH day_scores AS')) {
      const environment=args[2];
      const n={mixed:2,latest:1,'powered-cube':0}[environment];
      return {rows:Array.from({length:n},(_,i)=>({rank:i+1,player_id:'private',
        display_name:'Never print this name',score:86,average_score:87.5,days:3}))};
    }
    return {rows:[]};
  };
  const report=await recentSeasonRollover(query);
  assert.deepEqual(report.board_counts,{mixed:2,'powered-cube':0,latest:1});
  assert.equal(report.outgoing_set,'fra');
  assert.equal(report.incoming_set,'trk');
  assert.equal(seen.filter(x=>x.sql.includes('WITH day_scores AS')).length,3);
  assert.ok(seen.some(x=>x.sql.startsWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')));
  const display=formatSeasonRolloverReport(report);
  assert.match(display,/Mixed Daily: 2 eligible/);
  assert.doesNotMatch(display,/Never print this name|private/);
  assert.doesNotMatch(JSON.stringify(report),/Never print this name|private/);
});

test('no season rollover is a no-op, not a failure',async()=>{
  const report=await recentSeasonRollover(async()=>({rows:[]}));
  assert.equal(report,null);
  assert.match(formatSeasonRolloverReport(report),/No newly closed season/);
});
