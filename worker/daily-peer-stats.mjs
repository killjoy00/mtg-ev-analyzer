// Peer comparisons are calculated only after the current player has locked
// this exact Daily decision. We intentionally never return a sample count or percentages below 10 completed player picks.
export const MIN_DAILY_PEERS=10;

export const DAILY_PEER_STATS_SQL=`WITH daily_decisions AS (
  SELECT DISTINCT ON (COALESCE(s.daily_account_id::text,s.player_id::text))
    s.answers -> $4::int ->> 'selectedId' AS selected_id
  FROM draft_run_sessions s
  WHERE s.day=$1::date AND s.environment=$2
    AND s.puzzle_ids -> $4::int = to_jsonb($3::text)
    AND jsonb_array_length(s.answers)>$4::int
    AND s.answers -> $4::int -> 'puzzle' ->> 'puzzle_id'=$3
  ORDER BY COALESCE(s.daily_account_id::text,s.player_id::text),s.created_at,s.id
)
SELECT count(*)::int players,
       count(*) FILTER (WHERE selected_id=$5)::int matching_pick,
       count(*) FILTER (WHERE selected_id=$6)::int trophy_pick
FROM daily_decisions`;

export function lockedDailyPeerAnswer(session,round) {
  if(!session?.day||!Number.isInteger(round)||round<0||
      !Array.isArray(session.puzzle_ids)||round>=session.puzzle_ids.length)return null;
  const answer=session.answers?.[round];
  if(answer?.puzzle?.puzzle_id!==session.puzzle_ids[round]||
      typeof answer.selectedId!=='string'||!answer.selectedId||
      typeof answer.historicalId!=='string'||!answer.historicalId)return null;
  return answer;
}

export function summarizeDailyPeers(row) {
  const players=Number(row?.players);
  if(!Number.isSafeInteger(players)||players<MIN_DAILY_PEERS)return {available:false};
  const validCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&Number(value)<=players;
  if(!validCount(row.matching_pick)||!validCount(row.trophy_pick))return {available:false};
  const percentage=count=>Math.round(100*Number(count)/players);
  return {available:true,players,matching_pick_pct:percentage(row.matching_pick),trophy_pick_pct:percentage(row.trophy_pick)};
}
