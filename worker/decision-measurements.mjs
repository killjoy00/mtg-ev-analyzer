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
    FROM draft_run_sessions WHERE id=$1::uuid AND player_id=$2::uuid AND revision=$3::int AND jsonb_array_length(answers)<10
    ON CONFLICT(session_id,revision) DO UPDATE SET last_seen_at=now(),
      timing_reliable=draft_run_decision_observations.timing_reliable AND draft_run_decision_observations.view_id=EXCLUDED.view_id
    WHERE draft_run_decision_observations.outcome IS NULL RETURNING session_id`,[s.id,s.player_id,s.revision,viewId]);
  return {ok:result.rows.length>0};
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
