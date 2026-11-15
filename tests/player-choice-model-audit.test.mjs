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
  assert.match(sql,/max\(corpus_version\) corpus_version/,'source eras must be distinct');
  assert.match(sql,/model_sum BETWEEN 0\.99 AND 1\.01/);
  assert.match(sql,/accounted_votes=n/);
  assert.match(sql,/trophy_present/);
  assert.match(sql,/player_leader_votes>coalesce\(second_player_votes,-1\)/);
  assert.match(sql,/top_model_probability>coalesce\(second_model_probability,-1\)/);
  assert.match(sql,/model_leader=trophy_id/);
  assert.match(sql,/player_leader=trophy_id/);
  assert.doesNotMatch(sql,/score\s*[><=]/i,'awarded score cannot be a validation target');
  assert.doesNotMatch(sql,/\bSELECT\s+player_id\b/i,'no individual player identifiers returned');
  assert.match(sql,/FROM valid GROUP BY environment,corpus_version/,'only source-corpus and format aggregates returned');
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


test('optional model-audit SQL failure does not block existing protected review results',async()=>{
  const {handleAdmin}=await import('../worker/measurement-admin.mjs');
  let auditCalled=0;
  const query=async sql=>{
    if(sql.includes('FROM neon_auth.session s'))return {rows:[{user_id:'11111111-1111-4111-8111-111111111111'}]};
    if(sql.includes('SELECT role FROM pack1_admins'))return {rows:[{role:'owner'}]};
    if(sql.includes('WITH scoped AS ('))return {rows:[{puzzle_id:'synthetic',answers:51}]};
    if(sql.includes('WITH votes AS MATERIALIZED')){auditCalled++;throw Error('synthetic timeout');}
    throw Error('Unexpected query');
  };
  const request=new Request('https://packone.pro/v1/admin/measurements/reviews?from=2026-11-01&to=2026-11-15',{
    headers:{'x-pack1-auth-session':'synthetic-admin-token'},
  });
  const result=await handleAdmin(request,query,async()=>({}));
  assert.equal(auditCalled,1);
  assert.equal(result.reviews.length,1);
  assert.equal(result.player_model_audit.unavailable,true);
  assert.deepEqual(result.player_model_audit.rows,[]);
});
