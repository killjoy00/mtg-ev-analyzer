-- Use the JSON array from the fingerprint export as the $1 parameter.
-- Exact match: candidate IDs AND historical choice at every P1P1..P1P11.
-- TMT has invalid earlier-pick reconstruction in the old importer and is excluded.
WITH sequences AS (
  SELECT set_id,source_draft_hash,
    md5(string_agg(pick_number::text||':'||historical_pick_id||':'||
      (SELECT string_agg(c->>'id',',' ORDER BY c->>'id') FROM jsonb_array_elements(candidates)c),
      '|' ORDER BY pick_number)) fingerprint,
    min(event_match_wins) wins,min(player_games_lower_bound) games,
    min(player_win_rate_bucket) win_rate
  FROM draft_run_puzzles WHERE set_id<>'tmt' AND pick_number<=11
  GROUP BY set_id,source_draft_hash HAVING count(*)=11
), wanted AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) w(set_id text,draft_id text,fingerprint text)
)
SELECT s.*,w.draft_id FROM sequences s JOIN wanted w USING(set_id,fingerprint)
WHERE wins=7 AND games>=100 AND win_rate>=.6 ORDER BY set_id,draft_id;
