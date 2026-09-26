import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('current retention views use the Pacific product calendar without rewriting migration 0006',()=>{
  const historical=fs.readFileSync('migrations/0006_retention_funnels.sql','utf8');
  const pacific=fs.readFileSync('migrations/0035_pacific_daily_calendar.sql','utf8');
  const canonical=fs.readFileSync('analytics/retention_funnel.sql','utf8');
  assert.match(historical,/America\/New_York/,'historical migration 0006 remains immutable');
  assert.doesNotMatch(pacific,/America\/New_York/);
  assert.match(pacific,/America\/Los_Angeles/g);
  assert.doesNotMatch(canonical,/America\/New_York/);
  assert.match(canonical,/America\/Los_Angeles/);
});


test('release schema verification requires Pacific retention views', () => {
  const source = fs.readFileSync('scripts/verify-neon-schema.mjs', 'utf8');
  assert.ok(source.includes('analytics_retention_cohorts'));
  assert.ok(source.includes('analytics_daily_next_day_retention'));
  assert.ok(source.includes('America/Los_Angeles'));
  assert.ok(source.includes('America/New_York'));
  assert.ok(source.includes('through 0042 first'));
});
