// Peer comparisons are calculated only after the current player has locked
// this exact Daily decision. We intentionally never return a sample count or percentages below 10 completed player picks.
export const MIN_DAILY_PEERS=10;

// Count from the narrow per-pick observation rows (indexed by puzzle) rather
// than reading every same-day session's full answers document.
export const DAILY_PEER_STATS_SQL=`WITH daily_decisions AS (
  SELECT DISTINCT ON (COALESCE(s.daily_account_id::text,s.player_id::text))
    o.selected_id
  FROM draft_run_decision_observations o
  JOIN draft_run_sessions s ON s.id=o.session_id
  WHERE o.puzzle_id=$3::text AND o.round=$4::int+1 AND o.outcome='pick'
    AND s.day=$1::date AND s.environment=$2
    AND NOT s.measurement_qa
  ORDER BY COALESCE(s.daily_account_id::text,s.player_id::text),s.created_at,s.id
)
SELECT count(*)::int players,
       count(*) FILTER (WHERE selected_id=$5)::int matching_pick,
       count(*) FILTER (WHERE selected_id=$6)::int trophy_pick,
       COALESCE((SELECT jsonb_object_agg(selected_id,picks)
         FROM (SELECT selected_id,count(*)::int picks FROM daily_decisions GROUP BY selected_id) card_counts),'{}'::jsonb) card_picks
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
  const summary={available:true,players,matching_pick_pct:percentage(row.matching_pick),trophy_pick_pct:percentage(row.trophy_pick)};
  // Per-card shares use the same threshold as the summary. A malformed
  // breakdown is dropped rather than shown, without hiding the summary.
  let cards=row.card_picks;
  try {if(typeof cards==='string')cards=JSON.parse(cards);} catch {cards=null;}
  if(cards&&typeof cards==='object'&&!Array.isArray(cards)) {
    const entries=Object.entries(cards);
    if(entries.every(([,count])=>validCount(count))&&entries.reduce((sum,[,count])=>sum+Number(count),0)<=players)
      summary.card_pick_pct=Object.fromEntries(entries.map(([id,count])=>[id,percentage(count)]));
  }
  return summary;
}
