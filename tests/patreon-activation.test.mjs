import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [activation,growth,bootstrap,funnel,growthWorker,patreonWorker]=await Promise.all([
  readFile(new URL('../patreon-activation.mjs',import.meta.url),'utf8'),
  readFile(new URL('../growth.mjs',import.meta.url),'utf8'),
  readFile(new URL('../bootstrap.mjs',import.meta.url),'utf8'),
  readFile(new URL('../analytics/patreon_activation_funnel.sql',import.meta.url),'utf8'),
  readFile(new URL('../worker/growth-function.js',import.meta.url),'utf8'),
  readFile(new URL('../worker/patreon.mjs',import.meta.url),'utf8'),
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

test('activation separates browser UX stages from the authoritative Elite transition',()=>{
  assert.match(activation,/patreon_activation_started/);
  assert.match(activation,/patreon_activation_oauth_started/);
  assert.match(activation,/patreon_activation_succeeded/);
  assert.match(activation,/trackEvent as event/);
  assert.match(growth,/elite_upgrade_handoff/);
  assert.match(growth,/await flushEvents\(\)\.catch/);
  assert.match(activation,/await flushEvents\(\)\.catch/);

  assert.match(growthWorker,/SERVER_EVENTS=.*elite_activated/);
  assert.match(patreonWorker,/INSERT INTO analytics_events\(player_id,event_name,event_props\)/);
  assert.match(patreonWorker,/'elite_activated'/);
  assert.match(funnel,/event_name='elite_activated'/);
  assert.match(funnel,/patreon_activation_succeeded'\) AS browser_success_at/);
  assert.doesNotMatch(funnel,/patreon_activation_succeeded'\) AS activated_at/);
  assert.match(funnel,/authoritatively_activated_sessions/);
  assert.match(funnel,/handoff_to_authoritative_activation_rate/);
  assert.match(funnel,/abandoned_activation_sessions/);
  assert.match(funnel,/browser_success_without_authoritative_activation/);
});

