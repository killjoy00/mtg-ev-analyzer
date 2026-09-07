import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const lifecycleModules = [
  'render-lifecycle.mjs',
  'bootstrap.mjs',
  'product.mjs',
  'flow-fixes.mjs',
  'growth.mjs',
  'retention.mjs',
  'social.mjs',
];

test('one centralized render lifecycle owns DOM mutation observation', () => {
  const sources = lifecycleModules.map(source);
  const observerCount = sources.reduce(
    (sum, text) => sum + (text.match(/\bnew MutationObserver\b/g)?.length || 0),
    0,
  );
  assert.equal(observerCount, 1);
  assert.match(source('render-lifecycle.mjs'), /new MutationObserver/);
  for (const path of lifecycleModules.filter((path) => path !== 'render-lifecycle.mjs')) {
    assert.doesNotMatch(source(path), /\bnew MutationObserver\b/, `${path} must subscribe to the shared lifecycle`);
  }
});

test('replay loading never monkeypatches global fetch', () => {
  const sources = ['bootstrap.mjs', 'replay-data.mjs', 'app.js', 'social.mjs'].map(source).join('\n');
  assert.doesNotMatch(sources, /globalThis\.fetch\s*=/);
  assert.match(source('app.js'), /loadReplayJson/);
  assert.match(source('social.mjs'), /loadReplayJson/);
});

test('obsolete patch modules stay removed', () => {
  const root = new URL('../', import.meta.url);
  assert.equal(existsSync(new URL('human-copy.mjs', root)), false);
  assert.equal(existsSync(new URL('replay-runtime.mjs', root)), false);
  assert.doesNotMatch(source('bootstrap.mjs'), /human-copy|replay-runtime/);
  assert.doesNotMatch(source('package.json'), /human-copy|replay-runtime/);
});

test('the page has one stylesheet entrypoint and no inline style block', () => {
  const html = source('index.html');
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gi)].map((match) => match[1]);
  assert.deepEqual(stylesheets, ['pack1.css?v=4']);
});
