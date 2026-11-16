-- Read-only exports for research/difficulty-review-2026-11/evaluate.mjs.
-- Run each statement against the production pack1 database with a read-only
-- role and save its rows as JSON. Every row is one puzzle with aggregate
-- counts. The person key exists only inside the query, to keep each person's
-- first encounter with a puzzle; it is never selected.

-- answers.json: first-encounter Daily answers per puzzle.
WITH obs AS (
  SELECT o.puzzle_id,o.selected_id,o.score,o.trophy_match,o.active_ms,o.timing_reliable,o.first_seen_at,s.day,s.environment,
    coalesce(s.daily_account_id::text,(SELECT min(a.auth_user_id::text) FROM account_links a WHERE a.player_id=s.player_id),'g:'||s.player_id::text) person
  FROM draft_run_decision_observations o JOIN draft_run_sessions s ON s.id=o.session_id JOIN players p ON p.id=s.player_id
  WHERE o.observed AND o.outcome='pick' AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (SELECT 1 FROM account_links al JOIN pack1_admins ad ON ad.auth_user_id=al.auth_user_id WHERE al.player_id=s.player_id)
), ranked AS (SELECT *,row_number() OVER (PARTITION BY person,puzzle_id ORDER BY first_seen_at) rn FROM obs),
f AS (SELECT * FROM ranked WHERE rn=1 AND day BETWEEN '2026-10-04' AND '2026-11-15'),
ch AS (SELECT puzzle_id,selected_id,count(*) c,round(avg(score)) sc FROM f GROUP BY 1,2),
agg AS (SELECT puzzle_id,count(*) n,count(*) FILTER (WHERE trophy_match) tm,round(avg(score),2) mean_score,
    count(*) FILTER (WHERE score>=75) n75,count(*) FILTER (WHERE score<50) lt50,count(*) FILTER (WHERE score<25) lt25,
    count(*) FILTER (WHERE timing_reliable AND active_ms IS NOT NULL) nt,
    round(percentile_cont(.5) WITHIN GROUP (ORDER BY active_ms) FILTER (WHERE timing_reliable AND active_ms IS NOT NULL)) med_ms,
    min(day) d0,max(day) d1,string_agg(DISTINCT environment,',') envs FROM f GROUP BY 1)
SELECT jsonb_build_object('id',agg.puzzle_id,'n',n,'tm',tm,'ms',mean_score,'n75',n75,'lt50',lt50,'lt25',lt25,'nt',nt,'med',med_ms,'d0',d0,'d1',d1,'envs',envs,
  'ch',(SELECT jsonb_object_agg(selected_id,jsonb_build_array(c,sc)) FROM ch WHERE ch.puzzle_id=agg.puzzle_id))::text j
FROM agg WHERE n>=20 ORDER BY agg.puzzle_id;

-- meta.json: the scheduled Daily puzzles those answers belong to.
WITH sch AS (SELECT s.day,s.environment,s.selection_rule,(e.ord-1)::int slot,e.pid
  FROM draft_run_schedules s,jsonb_array_elements_text(s.puzzle_ids) WITH ORDINALITY e(pid,ord) WHERE s.day BETWEEN '2026-10-17' AND '2026-11-15')
SELECT jsonb_build_object('id',p.puzzle_id,'set',p.set_id,'pick',p.pick_number,'day',sch.day,'env',sch.environment,'rule',sch.selection_rule,
  'hist',p.payload->>'historical_pick_id',
  'c',(SELECT jsonb_agg(jsonb_build_array(c->>'id',c->>'name',c->>'rarity',c->>'mana_cost',c->>'type_line',(c->>'model_probability')::float8)) FROM jsonb_array_elements(p.payload->'candidates') c),
  'pp',(SELECT jsonb_agg(jsonb_build_array(c->>'name',c->>'rarity',c->>'mana_cost',c->>'type_line')) FROM jsonb_array_elements(p.payload->'prior_picks') c))::text j
FROM sch JOIN draft_run_verified_puzzles p ON p.puzzle_id=sch.pid ORDER BY sch.day,sch.environment,sch.slot;

-- practice_easy.json: first-encounter practice answers on easy-band puzzles
-- of the regular sets (the holdout).
WITH obs AS (
  SELECT o.puzzle_id,o.score,o.trophy_match,o.first_seen_at,s.day,s.challenge_id,s.environment,
    coalesce((SELECT min(a.auth_user_id::text) FROM account_links a WHERE a.player_id=s.player_id),'g:'||s.player_id::text) person
  FROM draft_run_decision_observations o JOIN draft_run_sessions s ON s.id=o.session_id JOIN players p ON p.id=s.player_id
  WHERE o.observed AND o.outcome='pick' AND NOT s.measurement_qa
    AND NOT coalesce(p.display_name ~* '^(QA([ _-]|$)|Import check$|Production smoke|Release check)',false)
    AND NOT EXISTS (SELECT 1 FROM account_links al JOIN pack1_admins ad ON ad.auth_user_id=al.auth_user_id WHERE al.player_id=s.player_id)
), ranked AS (SELECT *,row_number() OVER (PARTITION BY person,puzzle_id ORDER BY first_seen_at) rn FROM obs),
f AS (SELECT * FROM ranked WHERE rn=1 AND day IS NULL AND challenge_id IS NULL AND environment IN ('mixed','latest')),
agg AS (SELECT puzzle_id,count(*) n,count(*) FILTER (WHERE trophy_match) tm,count(*) FILTER (WHERE score<50) lt50,
    count(*) FILTER (WHERE score>=75) n75,sum(score) ss FROM f GROUP BY 1)
SELECT jsonb_build_object('id',p.puzzle_id,'set',p.set_id,'pick',p.pick_number,'n',agg.n,'tm',agg.tm,'lt50',agg.lt50,'n75',agg.n75,'ss',agg.ss,
  'hist',p.payload->>'historical_pick_id',
  'c',(SELECT jsonb_agg(jsonb_build_array(c->>'id',c->>'name',c->>'rarity',c->>'mana_cost',c->>'type_line',(c->>'model_probability')::float8)) FROM jsonb_array_elements(p.payload->'candidates') c),
  'pp',(SELECT jsonb_agg(jsonb_build_array(c->>'name',c->>'rarity',c->>'mana_cost',c->>'type_line')) FROM jsonb_array_elements(p.payload->'prior_picks') c))::text j
FROM agg JOIN draft_run_verified_puzzles p ON p.puzzle_id=agg.puzzle_id
JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
WHERE r.band='easy' AND p.pack_number=1 AND p.pick_number<=8;

-- pool_<sets>.json: the current serving easy pool, P1P1-P1P5, for chosen sets
-- (approximate serving filter: it omits active-snapshot membership). `src` is
-- a truncated source key, used only to apply the source repeat window.
SELECT jsonb_build_object('id',p.puzzle_id,'set',p.set_id,'pick',p.pick_number,'src',left(p.source_draft_hash,10),
  'hist',p.payload->>'historical_pick_id','deck',f.trophy_in_main_deck,'land',f.trophy_is_land,
  'c',(SELECT jsonb_agg(jsonb_build_array(c->>'id',c->>'name','',c->>'mana_cost','',(c->>'model_probability')::float8)) FROM jsonb_array_elements(p.payload->'candidates') c),
  'pp',(SELECT jsonb_agg(jsonb_build_array('','',c->>'mana_cost','')) FROM jsonb_array_elements(p.payload->'prior_picks') c))::text j
FROM draft_run_verified_puzzles p
JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
LEFT JOIN draft_run_puzzle_selection_features f ON f.puzzle_id=p.puzzle_id AND f.feature_version='stakes-v1'
WHERE p.set_id IN ('fra') AND p.corpus_version='elite-trophy-colour-stage-v10' AND p.interesting AND p.pack_number=1
  AND p.pick_number BETWEEN 1 AND 5 AND r.band='easy' AND r.target_support_ratio>=0.20526
  AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
  AND NOT EXISTS(SELECT 1 FROM draft_run_pick_removal_members m JOIN draft_run_pick_removals q USING(decision_key) WHERE m.puzzle_id=p.puzzle_id AND q.removed);
