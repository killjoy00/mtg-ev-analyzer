import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Pacific Daily calendar migration is exact-revision, fixed-migration, and release-window guarded',()=>{
  const source=fs.readFileSync('.github/workflows/daily-calendar-migration.yml','utf8');
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/03:00 through 23:59 Eastern/);
  assert.match(source,/TZ=America\/New_York date \+%H/);
  assert.match(source,/migrations\/0035_pacific_daily_calendar\.sql/);
  assert.match(source,/scripts\/verify-neon-schema\.mjs/);
  assert.match(source,/production deploy must finish before midnight Eastern/);
  assert.doesNotMatch(source,/migrations\/003[0-4]_/);
});
