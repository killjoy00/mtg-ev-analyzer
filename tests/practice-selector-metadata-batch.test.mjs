import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const previous=fs.readFileSync(new URL('../migrations/0051_exact_pick_draw_index.sql',import.meta.url),'utf8');
const proposed=fs.readFileSync(new URL('../migrations/0059_batch_practice_selected_metadata.sql',import.meta.url),'utf8');
const body=sql=>{
  const opening=sql.indexOf('AS $function$');
  const ending=sql.lastIndexOf('$function$;');
  assert.ok(opening>=0&&ending>opening,'function declaration must have one complete body');
  return sql.slice(opening+'AS $function$'.length,ending);
};
const prior=body(previous),next=body(proposed);
const unique=(sql,fragment)=>{
  assert.equal(sql.split(fragment).length-1,1,'expected exactly one '+fragment.slice(0,55));
  return sql.indexOf(fragment);
};

test('all eight seeded planning, difficulty, weighted-set, exclusion and indexed candidate draws remain byte-identical',()=>{
  const start='    WITH effective AS (';
  const beforeMetadata=unique(prior,'    SELECT to_jsonb(t) INTO chosen_metadata');
  const beforeGroup=unique(next,'    SELECT group_counts INTO round_delta');
  const oldStart=prior.indexOf(start),newStart=next.indexOf(start);
  assert.ok(oldStart>=0&&newStart>=0,'each selector must retain the first band-availability query');
  assert.ok(oldStart<beforeMetadata&&newStart<beforeGroup);
  assert.equal(next.slice(newStart,beforeGroup).trimEnd(),prior.slice(oldStart,beforeMetadata).trimEnd(),
    'Every round decision, band fallback, RNG use and exact-pick/range lookup is unchanged');
  const afterGroup='    SELECT group_counts INTO round_delta';
  const oldGroup=prior.slice(unique(prior,afterGroup),prior.lastIndexOf('  END LOOP;'));
  const newGroup=next.slice(unique(next,afterGroup),next.lastIndexOf('  END LOOP;'));
  const expected=oldGroup
    .replace('IF chosen_puzzle_id IS NULL OR chosen_metadata IS NULL THEN','IF chosen_puzzle_id IS NULL THEN')
    .replace('selected:=selected||jsonb_build_array(chosen_metadata)',
      'chosen_puzzle_ids:=array_append(chosen_puzzle_ids,chosen_puzzle_id)');
  assert.equal(newGroup,expected,'Original source trajectory/decrement rules and round failure remain unchanged');
  assert.equal((next.match(/ORDER BY i\.puzzle_id COLLATE "C" LIMIT 1 OFFSET chosen_offset;/g)||[]).length,2);
  assert.equal((next.match(/selected_sources:=array_append/g)||[]).length,1);
  assert.equal((next.match(/selected_sets:=array_append/g)||[]).length,1);
  assert.match(next,/IF current_revision IS DISTINCT FROM p_snapshot_revision THEN/);
});

test('metadata is fetched with one SQL statement in exact pick order and original eligibility predicates',()=>{
  const old=prior.match(/    SELECT to_jsonb\(t\) INTO chosen_metadata\n    FROM \(\n([\s\S]*?)\n    \) t;/);
  assert.ok(old,'reference metadata projection must be recognizable');
  assert.equal(old[1].split('WHERE p.puzzle_id=chosen_puzzle_id').length-1,1);
  const sameEligibility=old[1].replace('WHERE p.puzzle_id=chosen_puzzle_id',
    'WHERE p.puzzle_id=picked.puzzle_id');
  assert.ok(next.includes(sameEligibility),'all previously allowed corpus and rating filters remain identical');
  assert.equal((next.match(/SELECT to_jsonb\(t\)/g)||[]).length,1,'one metadata statement in the function');
  assert.ok(next.indexOf('SELECT to_jsonb(t)')>next.lastIndexOf('  END LOOP;'),
    'metadata lookup must occur only after all eight indexed draws');
  assert.match(next,/FROM unnest\(chosen_puzzle_ids\) WITH ORDINALITY AS picked\(puzzle_id,ordinality\)/);
  assert.match(next,/jsonb_agg\(meta\.metadata ORDER BY picked\.ordinality\)/);
  assert.match(next,/LEFT JOIN LATERAL \(/);
  assert.match(next,/MIN\\(picked\\.ordinality\\) FILTER \\(WHERE/);
  assert.match(next,/jsonb_typeof\\(meta\\.metadata\\) IS DISTINCT FROM 'object'/);
  assert.match(next,/meta\\.metadata->>'puzzle_id' IS DISTINCT FROM picked\\.puzzle_id/);
  assert.match(next,/meta\\.metadata->>'selected_id' IS DISTINCT FROM picked\\.puzzle_id/);
  assert.match(next,/jsonb_array_length\\(selected\\)<>8/);
  assert.ok(next.lastIndexOf('IF jsonb_typeof(selected)') <
    next.lastIndexOf('SELECT revision INTO current_revision'), 'exact-eight guard precedes final revision check');
  assert.match(next,/'round',\(missing_metadata_round-1\)::integer/);
  assert.match(next,/'draws_used',\(missing_metadata_round-1\)::integer\*2\+2/);
  assert.ok(next.indexOf('IF missing_metadata_round IS NOT NULL')<
    next.lastIndexOf('SELECT revision INTO current_revision'),'missing metadata must reject before last revision check');
  assert.doesNotMatch(proposed,/CREATE INDEX|CREATE TABLE|ALTER TABLE/i);
});

test('migration append and installed-body verification preserve the existing indexed selector contract',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../migrations/manifest.json',import.meta.url),'utf8'));
  const name='0059_batch_practice_selected_metadata.sql';
  assert.equal(manifest.ordered.at(-1),name);
  assert.equal(manifest.ordered.filter(x=>x===name).length,1);
  for(const plan of ['secure-auth-release','backend-gate-backlog','launch-load','launch-distributed']){
    assert.equal(manifest.release_paths[plan].migrations.at(-1),name,plan);
    assert.ok(manifest.release_paths[plan].migrations.includes('0051_exact_pick_draw_index.sql'),
      'keep the old indexed draw migration in the replay order');
  }
  const indexVerifier=fs.readFileSync(new URL('../scripts/verify-practice-draw-index.mjs',import.meta.url),'utf8');
  const liveSmoke=fs.readFileSync(new URL('admin-user-gateway-live-smoke.mjs',import.meta.url),'utf8');
  for(const source of [indexVerifier,liveSmoke])assert.match(source,/0059_batch_practice_selected_metadata\.sql/);
  assert.match(indexVerifier,/draft_run_inventory_pick_draw_idx/);
});
