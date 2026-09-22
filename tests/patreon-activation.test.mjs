import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [activation,growth,bootstrap,funnel]=await Promise.all([
  readFile(new URL('../patreon-activation.mjs',import.meta.url),'utf8'),
  readFile(new URL('../growth.mjs',import.meta.url),'utf8'),
  readFile(new URL('../bootstrap.mjs',import.meta.url),'utf8'),
  readFile(new URL('../analytics/patreon_activation_funnel.sql',import.meta.url),'utf8'),
]);

test('browser activation consumes server-derived Patreon state instead of reimplementing eligibility',()=>{
  assert.match(activation,/membership\?\.effective_state/);
  assert.match(activation,/capabilities\?\.includes\('custom_corpus'\)/);
  assert.match(activation,/capabilities\?\.includes\('unlimited_cube_practice'\)/);
  assert.doesNotMatch(activation,/last_charge_status|currently_entitled_amount_cents|premiumTierIds|declined_patron|refunded|fraud/i);
});

test('Patreon activation intent is distinct from one-shot account auth continuation',()=>{
  assert.match(activation,/pack1-patreon-activation-v1/);
  assert.match(growth,/pack1-auth-flow-v1/);
  assert.match(growth,/hasPatreonActivationIntent\(\)/);
  assert.match(growth,/rememberPatreonActivation\(source\)/);
  assert.doesNotMatch(activation,/pack1-auth-flow-v1/);
});

test('bootstrap distinguishes Welcome Note activation from ordinary Patreon callback handling',()=>{
  assert.match(bootstrap,/patreonResult==='activate'/);
  assert.match(bootstrap,/growth\.hasPatreonActivationIntent\(\)/);
  assert.match(bootstrap,/growth\.renderPatreonActivation/);
});

test('activation does not accept arbitrary browser return destinations',()=>{
  assert.doesNotMatch(activation,/returnUrl|return_url|redirectTo|redirect_to|searchParams\.get\(['"]return/);
  assert.match(activation,/target\.hostname!=='www\.patreon\.com'/);
});

test('activation emits a measurable start, OAuth, and success funnel',()=>{
  assert.match(activation,/patreon_activation_started/);
  assert.match(activation,/patreon_activation_oauth_started/);
  assert.match(activation,/patreon_activation_succeeded/);
  assert.match(activation,/trackEvent as event/);
  assert.match(funnel,/event_props->>'session_id'/);
  assert.match(funnel,/abandoned_activation_sessions/);
  assert.match(funnel,/activation_success_rate/);
  assert.match(funnel,/elite_upgrade_handoff/);
});

