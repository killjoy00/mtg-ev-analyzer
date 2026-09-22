import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [growth,draft]=await Promise.all([
  readFile(new URL('../growth.mjs',import.meta.url),'utf8'),
  readFile(new URL('../draft-run-product.mjs',import.meta.url),'utf8'),
]);

test('account access renders one contextual email mode with explicit Google sign-in copy',()=>{
  assert.match(growth,/Sign in with Google/);
  const render=growth.slice(growth.indexOf('export async function renderAccount'),growth.indexOf('function shareCompletedAnalytics'));
  assert.doesNotMatch(render,/account-columns/,'auth screen must not render both email columns');
  assert.match(render,/validatingDaily\|\|upgradingElite\|\|activatingPatreon\?'signup':'signin'/);
  assert.match(render,/intent==='patreon-activate'/);
  assert.match(render,/hasPatreonActivationIntent\(\)/);
  assert.match(render,/rememberPatreonActivation\(source\)/);
  assert.match(render,/New to Pack One\? .*Create account/);
  assert.match(render,/Already have an account\? .*Sign in/);
});

test('Google errors have an independent surface and account analytics keep source',()=>{
  assert.match(growth,/id="account-google-error"/);
  assert.doesNotMatch(growth,/#account-signin \.form-error/);
  assert.match(growth,/event\('auth_sign_up',\{source\}\)/);
  assert.match(growth,/event\('auth_sign_in',\{source\}\)/);
  assert.match(growth,/event\('daily_score_validated',\{source\}\)/);
});

test('verification-required signup is a success state',()=>{
  assert.match(growth,/Check your email — we sent a verification link to/);
  assert.match(growth,/account-verification-success/);
  assert.match(growth,/account-verification-signin/);
});

test('Daily auth preserves origin and returns to the completed result',()=>{
  assert.match(draft,/validateDailyRunId:run\.id,source:'daily_result'/);
  assert.match(draft,/export async function returnToValidatedDaily/);
  assert.match(draft,/Score added to today's leaderboard/);
  assert.match(draft,/View leaderboard/);
  assert.match(growth,/returnToValidatedDaily\(validationRunId,linked,source\)/);
});
