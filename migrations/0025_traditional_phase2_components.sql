-- Admit the already-reviewed all-environment Traditional Phase 2 component
-- revision without rewriting any retained Premier or historical component rows.
-- The existing source-evidence constraint is NOT VALID: old rows are not scanned,
-- while every newly inserted/updated puzzle is checked against the widened rule.
ALTER TABLE draft_run_verified_puzzles DROP CONSTRAINT IF EXISTS draft_run_source_evidence_required;
ALTER TABLE draft_run_verified_puzzles ADD CONSTRAINT draft_run_source_evidence_required CHECK ((
 (payload->>'event_match_wins')::int=7 AND coalesce(payload->>'source_event_type','PremierDraft')='PremierDraft'
 AND (payload->>'player_games_lower_bound')::int>=100
 AND ((payload->>'player_win_rate_bucket')::numeric BETWEEN .6 AND 1
      OR (set_id IN ('stx','mid','vow') AND payload->>'skill_evidence'='earliest_game_arena_rank'
          AND payload->>'player_rank_tier' IN ('diamond','mythic')))
 OR (payload->>'source_event_type'='TradDraft' AND (payload->>'event_match_wins')::int=3
     AND (payload->>'event_match_losses')::int=0 AND pick_number BETWEEN 1 AND 8
     AND ((set_id='powered-cube' AND corpus_version='traditional-cube-p2p7-v3-v1' AND pick_number BETWEEN 2 AND 7)
          OR (set_id<>'powered-cube' AND corpus_version IN ('traditional-premier-v3-v1','traditional-premier-v3-phase2-v1')))
     AND payload->>'corpus_version'=corpus_version
     AND payload->>'model_version'='strong-player-colour-stage-v3' AND payload->>'model_source_event'='PremierDraft'
     AND payload->>'skill_evidence'='win_rate_bucket' AND (payload->>'player_games_lower_bound')::int>=100
     AND (payload->>'player_win_rate_bucket')::numeric BETWEEN .6 AND 1)
) IS TRUE) NOT VALID;
