-- Current-practice-only bounded selector experiment for #629.
-- JS retains policy planning and RNG; this function executes only the eight
-- dependent snapshot-scoped source selections and broader trajectory decrements.
CREATE OR REPLACE FUNCTION public.pack1_select_serving_run_v1(p_snapshot_id bigint, p_snapshot_revision bigint, p_parent_version text, p_difficulty_version text, p_policy_version text, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  snapshot_row draft_run_serving_snapshots%ROWTYPE;
  current_revision bigint;
  round_index integer;
  window_start integer;
  window_end integer;
  desired_band text;
  chosen_band text;
  forced_set text;
  required_sets text[] := ARRAY[]::text[];
  selected_sources text[] := ARRAY[]::text[];
  selected_sets text[] := ARRAY[]::text[];
  available_sets text[];
  fresh_sets text[];
  different_sets text[];
  chosen_set text;
  chosen_count integer;
  chosen_offset integer;
  chosen_puzzle_id text;
  chosen_source text;
  chosen_metadata jsonb;
  round_delta jsonb;
  decrements jsonb := '{}'::jsonb;
  selected jsonb := '[]'::jsonb;
  set_random double precision;
  offset_random double precision;
  delta_key text;
  delta_value text;
BEGIN
  SELECT * INTO snapshot_row
  FROM draft_run_serving_snapshots s
  WHERE s.id=p_snapshot_id AND s.revision=p_snapshot_revision
    AND s.corpus_version=p_parent_version AND s.difficulty_version=p_difficulty_version
    AND s.serving_policy_version=p_policy_version AND s.cache_schema='serving-cache-v1';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','snapshot_unavailable','draws_used',0); END IF;
  SELECT revision INTO current_revision FROM draft_run_serving_revision WHERE singleton;
  IF current_revision IS DISTINCT FROM p_snapshot_revision THEN
    RETURN jsonb_build_object('ok',false,'error','snapshot_changed','draws_used',0);
  END IF;
  IF jsonb_typeof(p_plan)<>'object'
     OR jsonb_array_length(COALESCE(p_plan->'groups','[]'::jsonb))=0
     OR jsonb_array_length(COALESCE(p_plan->'windows','[]'::jsonb))<>8
     OR jsonb_array_length(COALESCE(p_plan->'bands','[]'::jsonb))<>8
     OR jsonb_array_length(COALESCE(p_plan->'forced','[]'::jsonb))<>8
     OR jsonb_array_length(COALESCE(p_plan->'round_randoms','[]'::jsonb))<>8
     OR COALESCE(p_plan->>'selection_version','')<>'eight-pick-v4' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_plan','draws_used',0);
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_plan->'groups') AS g(set_id text,pick_number integer,band text,n integer)
    WHERE g.set_id IS NULL OR g.pick_number IS NULL OR g.band IS NULL OR g.n IS NULL OR g.n<0
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(snapshot_row.groups) AS s(set_id text,pick_number integer,band text,n integer,sources integer)
         WHERE s.set_id=g.set_id AND s.pick_number=g.pick_number AND s.band=g.band AND s.n=g.n
       )
  ) THEN RETURN jsonb_build_object('ok',false,'error','invalid_plan','draws_used',0); END IF;
  SELECT COALESCE(array_agg(r.value ORDER BY r.ordinality),ARRAY[]::text[]) INTO required_sets
  FROM jsonb_array_elements_text(COALESCE(p_plan->'required','[]'::jsonb)) WITH ORDINALITY AS r(value,ordinality);
  FOR round_index IN 0..7 LOOP
    window_start := (p_plan->'windows'->round_index->>0)::integer;
    window_end := (p_plan->'windows'->round_index->>1)::integer;
    desired_band := p_plan->'bands'->>round_index;
    forced_set := NULLIF(p_plan->'forced'->>round_index,'');
    IF window_start IS NULL OR window_end IS NULL OR window_start>window_end OR desired_band NOT IN ('easy','medium','hard') THEN
      RETURN jsonb_build_object('ok',false,'error','invalid_plan','draws_used',round_index*2);
    END IF;
    chosen_band := desired_band;
    WITH effective AS (
      SELECT g.set_id,g.n-COALESCE((decrements->>(g.set_id||':'||g.pick_number||':'||g.band))::integer,0) n
      FROM jsonb_to_recordset(p_plan->'groups') AS g(set_id text,pick_number integer,band text,n integer)
      WHERE g.band=chosen_band AND g.pick_number BETWEEN window_start AND window_end
        AND ((forced_set IS NOT NULL AND g.set_id=forced_set) OR (forced_set IS NULL AND NOT (g.set_id=ANY(required_sets))))
    ), available AS (SELECT set_id,sum(n)::integer n FROM effective WHERE n>0 GROUP BY set_id)
    SELECT COALESCE(array_agg(set_id ORDER BY set_id COLLATE "C"),ARRAY[]::text[]) INTO available_sets FROM available;
    IF cardinality(available_sets)=0 AND desired_band='easy' THEN
      chosen_band := 'medium';
      WITH effective AS (
        SELECT g.set_id,g.n-COALESCE((decrements->>(g.set_id||':'||g.pick_number||':'||g.band))::integer,0) n
        FROM jsonb_to_recordset(p_plan->'groups') AS g(set_id text,pick_number integer,band text,n integer)
        WHERE g.band=chosen_band AND g.pick_number BETWEEN window_start AND window_end
          AND ((forced_set IS NOT NULL AND g.set_id=forced_set) OR (forced_set IS NULL AND NOT (g.set_id=ANY(required_sets))))
      ), available AS (SELECT set_id,sum(n)::integer n FROM effective WHERE n>0 GROUP BY set_id)
      SELECT COALESCE(array_agg(set_id ORDER BY set_id COLLATE "C"),ARRAY[]::text[]) INTO available_sets FROM available;
    END IF;
    IF cardinality(available_sets)=0 THEN
      RETURN jsonb_build_object('ok',false,'error','not_enough_verified_puzzles','round',round_index,'draws_used',round_index*2);
    END IF;
    IF forced_set IS NULL THEN
      SELECT COALESCE(array_agg(s ORDER BY s COLLATE "C"),ARRAY[]::text[]) INTO fresh_sets FROM unnest(available_sets) s WHERE NOT (s=ANY(selected_sets));
      IF cardinality(fresh_sets)>0 THEN available_sets:=fresh_sets;
      ELSE
        SELECT COALESCE(array_agg(s ORDER BY s COLLATE "C"),ARRAY[]::text[]) INTO different_sets FROM unnest(available_sets) s WHERE s IS DISTINCT FROM selected_sets[array_length(selected_sets,1)];
        IF cardinality(different_sets)>0 THEN available_sets:=different_sets; END IF;
      END IF;
    ELSE
      SELECT COALESCE(array_agg(s ORDER BY s COLLATE "C"),ARRAY[]::text[]) INTO different_sets FROM unnest(available_sets) s WHERE s IS DISTINCT FROM selected_sets[array_length(selected_sets,1)];
      IF cardinality(different_sets)>0 THEN available_sets:=different_sets; END IF;
    END IF;
    set_random := (p_plan->'round_randoms'->round_index->>'set')::double precision;
    offset_random := (p_plan->'round_randoms'->round_index->>'offset')::double precision;
    IF set_random<0 OR set_random>=1 OR offset_random<0 OR offset_random>=1 THEN
      RETURN jsonb_build_object('ok',false,'error','invalid_plan','draws_used',round_index*2);
    END IF;
    chosen_set := available_sets[1+floor(set_random*cardinality(available_sets)::double precision)::integer];
    WITH effective AS (
      SELECT g.n-COALESCE((decrements->>(g.set_id||':'||g.pick_number||':'||g.band))::integer,0) n
      FROM jsonb_to_recordset(p_plan->'groups') AS g(set_id text,pick_number integer,band text,n integer)
      WHERE g.set_id=chosen_set AND g.band=chosen_band AND g.pick_number BETWEEN window_start AND window_end
    ) SELECT COALESCE(sum(n) FILTER (WHERE n>0),0)::integer INTO chosen_count FROM effective;
    IF chosen_count<=0 THEN
      RETURN jsonb_build_object('ok',false,'error','not_enough_verified_puzzles','round',round_index,'draws_used',round_index*2+1);
    END IF;
    chosen_offset := floor(offset_random*chosen_count::double precision)::integer;
    WITH chosen AS (
      SELECT i.puzzle_id,i.source_draft_hash FROM draft_run_serving_inventory i
      WHERE i.snapshot_id=p_snapshot_id AND i.pick_number BETWEEN window_start AND window_end
        AND i.source_draft_hash<>ALL(selected_sources) AND i.set_id=chosen_set AND i.band=chosen_band
      ORDER BY i.puzzle_id COLLATE "C" LIMIT 1 OFFSET chosen_offset
    ), trajectory AS (
      SELECT p.puzzle_id,p.set_id,p.corpus_version,p.source_draft_hash,p.pack_number,p.pick_number,p.candidate_count,
        p.consensus_top_gap,p.support_entropy,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio,r.band,chosen.puzzle_id selected_id
      FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
      JOIN chosen ON chosen.source_draft_hash=p.source_draft_hash
      WHERE p.corpus_version IN (SELECT p_parent_version UNION SELECT c.component_version FROM corpus_components c WHERE c.parent_version=p_parent_version)
        AND (p.corpus_version=p_parent_version OR EXISTS(SELECT 1 FROM corpus_components c WHERE c.parent_version=p_parent_version AND c.component_version=p.corpus_version AND c.set_id=p.set_id))
        AND p.interesting AND p.pack_number=1 AND r.target_support_ratio>=0.20526315789473684::float8
    ), selected_row AS (SELECT to_jsonb(t)-'selected_id' item FROM trajectory t WHERE t.puzzle_id=t.selected_id LIMIT 1),
    delta AS (
      SELECT COALESCE(jsonb_object_agg(d.key,d.n),'{}'::jsonb) items FROM (
        SELECT t.set_id||':'||t.pick_number||':'||t.band key,count(*)::integer n FROM trajectory t
        WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(p_plan->'groups') AS g(set_id text,pick_number integer,band text,n integer)
          WHERE g.set_id=t.set_id AND g.pick_number=t.pick_number AND g.band=t.band)
        GROUP BY t.set_id,t.pick_number,t.band
      ) d
    )
    SELECT c.puzzle_id,c.source_draft_hash,s.item,d.items INTO chosen_puzzle_id,chosen_source,chosen_metadata,round_delta
    FROM chosen c LEFT JOIN selected_row s ON true LEFT JOIN delta d ON true;
    IF chosen_puzzle_id IS NULL OR chosen_metadata IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','corpus_changed','round',round_index,'draws_used',round_index*2+2);
    END IF;
    selected:=selected||jsonb_build_array(chosen_metadata);selected_sources:=array_append(selected_sources,chosen_source);selected_sets:=array_append(selected_sets,chosen_set);
    FOR delta_key,delta_value IN SELECT e.key,e.value FROM jsonb_each_text(COALESCE(round_delta,'{}'::jsonb)) e LOOP
      decrements:=jsonb_set(decrements,ARRAY[delta_key],to_jsonb(COALESCE((decrements->>delta_key)::integer,0)+delta_value::integer),true);
    END LOOP;
  END LOOP;
  SELECT revision INTO current_revision FROM draft_run_serving_revision WHERE singleton;
  IF current_revision IS DISTINCT FROM p_snapshot_revision THEN
    RETURN jsonb_build_object('ok',false,'error','snapshot_changed','draws_used',16);
  END IF;
  RETURN jsonb_build_object('ok',true,'selections',selected,'draws_used',16);
END;
$function$

