import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAYER_MODEL_AUDIT_SQL,PLAYER_MODEL_AUDIT_MIN_CHOICES,playerModelAuditWindow,
} from '../worker/player-choice-model-audit.mjs';

test('player/model audit never counts QA, repeats, non-answers or other run types',()=>{
  const sql=PLAYER_MODEL_AUDIT_SQL;
  for(const clause of ["run_type='daily'","observed","NOT is_qa","first_encounter","outcome='pick'"])
    assert.ok(sql.includes(clause),clause);
  assert.match(sql,/HAVING sum\(votes\)>=\$3::int/);
  assert.equal(PLAYER_MODEL_AUDIT_MIN_CHOICES,50);
  assert.match(sql,/first_seen_at>=\(\$1::date::timestamp AT TIME ZONE 'America\/Los_Angeles'\)/);
  assert.match(sql,/first_seen_at<\(\(\$2::date\+1\)::timestamp AT TIME ZONE 'America\/Los_Angeles'\)/);
});

test('model comparison uses original candidate probabilities and historical trophy without treating scores as truth',()=>{
  const sql=PLAYER_MODEL_AUDIT_SQL;
  assert.match(sql,/model_probability/);
  assert.match(sql,/historical_pick_id/);
  assert.match(sql,/model_sum BETWEEN 0\.99 AND 1\.01/);
  assert.match(sql,/accounted_votes=n/);
  assert.match(sql,/trophy_present/);
  assert.match(sql,/player_leader_votes>coalesce\(second_player_votes,-1\)/);
  assert.match(sql,/top_model_probability>coalesce\(second_model_probability,-1\)/);
  assert.match(sql,/model_leader=trophy_id/);
  assert.match(sql,/player_leader=trophy_id/);
  assert.doesNotMatch(sql,/score\s*[><=]/i,'awarded score cannot be a validation target');
  assert.doesNotMatch(sql,/\bSELECT\s+player_id\b/i,'no individual player identifiers returned');
  assert.match(sql,/FROM valid GROUP BY environment/,'only format-level aggregates returned');
});

test('read-only audit window keeps at most 90 Pacific dates',()=>{
  assert.deepEqual(playerModelAuditWindow('2026-09-16','2026-11-15'),{
    from:'2026-09-16',to:'2026-11-15',clipped:false,
  });
  assert.deepEqual(playerModelAuditWindow('2026-01-01','2026-11-15'),{
    from:'2026-08-18',to:'2026-11-15',clipped:true,
  });
  assert.deepEqual(playerModelAuditWindow('2026-10-31','2026-10-31'),{
    from:'2026-10-31',to:'2026-10-31',clipped:false,
  });
});

test('existing authenticated reviews route and deferred Insights UI keep the audit private',()=>{
  const backend=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  const frontend=fs.readFileSync('admin/admin.mjs','utf8');
  assert.match(backend,/const member=await query\('SELECT role FROM pack1_admins/);
  assert.match(backend,/if\(!role\)fail\('This account does not have administrator access\.',403\)/);
  const reviews=backend.slice(backend.indexOf("if(url.pathname==='/v1/admin/measurements/reviews')"),backend.indexOf("if(url.pathname==='/v1/admin/measurements')"));
  assert.match(reviews,/PLAYER_MODEL_AUDIT_SQL/);
  assert.match(reviews,/player_model_audit:\{window:auditWindow,min_choices:PLAYER_MODEL_AUDIT_MIN_CHOICES,rows:modelAudit\.rows\}/);
  assert.match(frontend,/modelAuditMarkup\(data\.player_model_audit\)/);
  assert.match(frontend,/id="player-model-audit"/);
  assert.doesNotMatch(reviews,/console\.(log|info|warn)\(/,'never log private data');
});
