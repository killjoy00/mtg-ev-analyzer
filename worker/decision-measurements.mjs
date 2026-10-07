const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function measurementInput(body) {
  return {viewId:UUID.test(body.viewId||'')?body.viewId:null,
    activeMs:Number.isInteger(body.activeMs)&&body.activeMs>=0&&body.activeMs<=1800000?body.activeMs:null};
}
export async function observeDecision(query,s,body) {
  const {viewId}=measurementInput(body);
  if(!viewId)throw Object.assign(Error('Valid view ID required.'),{status:400});
  const result=await query(`INSERT INTO draft_run_decision_observations(session_id,revision,round,puzzle_id,observed,view_id)
    SELECT id,revision,jsonb_array_length(answers)+1,puzzle_ids->>jsonb_array_length(answers),true,$4::uuid
    FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid AND revision=$3::int AND jsonb_array_length(answers)<jsonb_array_length(puzzle_ids)
    ON CONFLICT(session_id,revision) DO UPDATE SET last_seen_at=now(),
      timing_reliable=draft_run_decision_observations.timing_reliable AND draft_run_decision_observations.view_id=EXCLUDED.view_id
    WHERE draft_run_decision_observations.outcome IS NULL RETURNING session_id`,[s.id,s.player_id,s.revision,viewId]);
  return {ok:result.rows.length>0};
}
// Authorize and record a view in one database request. Return only validation
// flags, rather than transferring the session's growing answer history.
export async function observeDecisionForRequest(query,id,playerId,body) {
  const fail=(message,status)=>{throw Object.assign(Error(message),{status});};
  if(!UUID.test(id))fail('Invalid run.',400);
  const {viewId}=measurementInput(body);
  const revision=Number.isInteger(body.revision)&&body.revision>=-2147483648&&body.revision<=2147483647?body.revision:null;
  const validPuzzleType=typeof body.puzzleId==='string'||body.puzzleId===undefined;
  const result=await query(`WITH current_run AS MATERIALIZED (
      SELECT id,revision,jsonb_array_length(answers)+1 round,
        puzzle_ids->>jsonb_array_length(answers) puzzle_id,
        jsonb_array_length(answers)<jsonb_array_length(puzzle_ids) in_progress
      FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid
    ), observed AS (
      INSERT INTO draft_run_decision_observations(session_id,revision,round,puzzle_id,observed,view_id)
      SELECT id,revision,round,puzzle_id,true,$5::uuid FROM current_run
      WHERE revision=$3::int AND puzzle_id IS NOT DISTINCT FROM $4::text
        AND $6::boolean AND in_progress AND $5::uuid IS NOT NULL
      ON CONFLICT(session_id,revision) DO UPDATE SET last_seen_at=now(),
        timing_reliable=draft_run_decision_observations.timing_reliable AND draft_run_decision_observations.view_id=EXCLUDED.view_id
      WHERE draft_run_decision_observations.outcome IS NULL RETURNING session_id
    ) SELECT EXISTS(SELECT 1 FROM current_run) found,
      coalesce((SELECT revision=$3::int AND puzzle_id IS NOT DISTINCT FROM $4::text AND $6::boolean FROM current_run),false) matches,
      EXISTS(SELECT 1 FROM observed) ok`,[id,playerId,revision,typeof body.puzzleId==='string'?body.puzzleId:null,viewId,validPuzzleType]);
  const row=result.rows[0],truth=value=>value===true||value==='t';
  if(!truth(row?.found))fail('Run not found.',404);
  if(!truth(row.matches))fail('Run changed.',409);
  if(!viewId)fail('Valid view ID required.',400);
  return {ok:truth(row.ok)};
}
// Runs in the SAME SQL statement as the optimistic session update. A lost
// response, duplicate request or concurrent tab cannot double-count an outcome.
export const MEASUREMENT_CTE=`measured AS (
  INSERT INTO draft_run_decision_observations(session_id,revision,round,puzzle_id,outcome,answered_at,selected_id,score,trophy_match)
  SELECT id,$2::int,$9::int,$10,$11,now(),$12,$13::int,$14::boolean FROM changed
  ON CONFLICT(session_id,revision) DO UPDATE SET outcome=EXCLUDED.outcome,answered_at=now(),
    selected_id=EXCLUDED.selected_id,score=EXCLUDED.score,trophy_match=EXCLUDED.trophy_match,
    active_ms=CASE WHEN draft_run_decision_observations.observed AND draft_run_decision_observations.timing_reliable
      AND draft_run_decision_observations.view_id=$15::uuid
      AND $16::int<=1000*extract(epoch FROM now()-draft_run_decision_observations.first_seen_at)+5000
      THEN $16::int ELSE NULL END
  RETURNING session_id
)`;
