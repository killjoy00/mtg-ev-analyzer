// Private Admin-only aggregate audit. Do not send puzzle-level votes or player identifiers to public logs/artifacts.
// Diagnostics only: Pack One player consensus is not ground truth or an objective measure of card value.
export const PLAYER_MODEL_AUDIT_MIN_CHOICES=50;
export const PLAYER_MODEL_AUDIT_SQL=`
WITH votes AS MATERIALIZED (
  SELECT environment,puzzle_id,selected_id,count(*)::int votes
  FROM draft_run_source_measurements
  WHERE first_seen_at>=($1::date::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND first_seen_at<(($2::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')
    AND run_type='daily' AND observed AND NOT is_qa AND first_encounter AND outcome='pick'
  GROUP BY environment,puzzle_id,selected_id
), eligible AS (
  SELECT environment,puzzle_id,sum(votes)::int n
  FROM votes GROUP BY environment,puzzle_id HAVING sum(votes)>=$3::int
), cards AS (
  SELECT e.environment,e.puzzle_id,e.n,p.pick_number,
    p.payload->>'historical_pick_id' trophy_id,
    c->>'id' card_id,coalesce((c->>'model_probability')::numeric,0) model_p,
    coalesce(v.votes,0)::int votes,coalesce(v.votes,0)::numeric/e.n player_p
  FROM eligible e JOIN draft_run_verified_puzzles p USING(puzzle_id)
  CROSS JOIN LATERAL jsonb_array_elements(p.payload->'candidates') c
  LEFT JOIN votes v ON v.environment=e.environment AND v.puzzle_id=e.puzzle_id AND v.selected_id=c->>'id'
), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY environment,puzzle_id ORDER BY model_p DESC,card_id) model_rank,
    row_number() OVER(PARTITION BY environment,puzzle_id ORDER BY votes DESC,card_id) player_rank
  FROM cards
), puzzle AS (
  SELECT environment,puzzle_id,max(n)::int n,max(pick_number)::int pick_number,
    max(trophy_id) trophy_id,
    sum(votes)::int accounted_votes,sum(model_p) model_sum,
    bool_or(card_id=trophy_id) trophy_present,
    max(card_id) FILTER(WHERE model_rank=1) model_leader,
    max(card_id) FILTER(WHERE player_rank=1) player_leader,
    max(votes) FILTER(WHERE model_rank=1) model_leader_votes,
    max(votes) FILTER(WHERE player_rank=1) player_leader_votes,
    max(votes) FILTER(WHERE player_rank=2) second_player_votes,
    max(model_p) FILTER(WHERE model_rank=1) top_model_probability,
    max(model_p) FILTER(WHERE model_rank=2) second_model_probability,
    sum(CASE WHEN model_p+player_p>0 THEN
      (CASE WHEN model_p>0 THEN 0.5*model_p*ln(2*model_p/(model_p+player_p)) ELSE 0 END)
      +(CASE WHEN player_p>0 THEN 0.5*player_p*ln(2*player_p/(model_p+player_p)) ELSE 0 END)
      ELSE 0 END)/ln(2.0) js_bits
  FROM ranked GROUP BY environment,puzzle_id
), valid AS (
  SELECT * FROM puzzle
  WHERE accounted_votes=n AND model_sum BETWEEN 0.99 AND 1.01
    AND trophy_present AND player_leader_votes>coalesce(second_player_votes,-1)
    AND top_model_probability>coalesce(second_model_probability,-1)
)
SELECT environment,count(*)::int qualified_puzzles,sum(n)::int choices,
  count(*) FILTER(WHERE player_leader<>model_leader)::int differing_leaders,
  round(100.0*count(*) FILTER(WHERE player_leader<>model_leader)/nullif(count(*),0),1) differing_pct,
  count(*) FILTER(WHERE player_leader=trophy_id)::int player_majority_trophy,
  count(*) FILTER(WHERE model_leader=trophy_id)::int model_leader_trophy,
  count(*) FILTER(WHERE player_leader<>model_leader AND player_leader=trophy_id)::int disagreement_players_trophy,
  count(*) FILTER(WHERE player_leader<>model_leader AND model_leader=trophy_id)::int disagreement_model_trophy,
  round(100.0*sum(model_leader_votes)/nullif(sum(n),0),1) voted_model_leader_pct,
  round(100.0*sum(n*top_model_probability)/nullif(sum(n),0),1) predicted_model_leader_pct,
  round(avg(js_bits)::numeric,3) mean_js_bits
FROM valid GROUP BY environment ORDER BY environment
`;

// Keep the expensive first-encounter scan to at most 90 Pacific calendar days.
// Date validation and admin authorization are enforced by measurement-admin.mjs.
export function playerModelAuditWindow(from,to) {
  const day=new Date(to+'T12:00:00Z');
  day.setUTCDate(day.getUTCDate()-89);
  const earliest=day.toISOString().slice(0,10);
  return {from:from<earliest?earliest:from,to,clipped:from<earliest};
}
