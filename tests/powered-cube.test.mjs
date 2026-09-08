import test from 'node:test';
import assert from 'node:assert/strict';

import { POWERED_CUBE_ID, poweredCubeUrl } from '../cube-product.mjs';

test('Powered Cube practice URL is a dedicated Pack Run', () => {
  const url = new URL(poweredCubeUrl({
    origin: 'https://magic.planitnow.us/',
    seed: 'abc123',
  }));
  assert.equal(url.searchParams.get('set'), POWERED_CUBE_ID);
  assert.equal(url.searchParams.get('mode'), 'full');
  assert.equal(url.searchParams.get('seed'), 'abc123');
  assert.equal(url.searchParams.has('daily'), false);
});

test('Powered Cube Daily uses its separate environment on the ranked route', () => {
  const url = new URL(poweredCubeUrl({
    origin: 'https://magic.planitnow.us/',
    mode: 'full',
    daily: '2026-09-08',
  }));
  assert.equal(url.searchParams.get('set'), POWERED_CUBE_ID);
  assert.equal(url.searchParams.get('mode'), 'full');
  assert.equal(url.searchParams.get('daily'), '2026-09-08');
  assert.equal(url.searchParams.has('seed'), false);
});

test('Powered Cube does not expose normal Top 3 or other set modes', () => {
  assert.throws(() => poweredCubeUrl({ mode: 'top3' }), /Unsupported Powered Cube mode/);
  assert.throws(() => poweredCubeUrl({ mode: 'sealed' }), /Unsupported Powered Cube mode/);
});
