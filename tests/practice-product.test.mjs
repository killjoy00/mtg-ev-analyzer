import assert from 'node:assert/strict';
import test from 'node:test';

import { practiceLaunchUrl } from '../practice-product.mjs';

test('Set Practice launches a seeded run locked to one expansion', () => {
  const url = new URL(practiceLaunchUrl({
    origin: 'https://magic.planitnow.us/',
    setId: 'msh',
    mode: 'top3',
    seed: 'practice-seed',
  }));
  assert.equal(url.searchParams.get('set'), 'msh');
  assert.equal(url.searchParams.get('mode'), 'top3');
  assert.equal(url.searchParams.get('seed'), 'practice-seed');
  assert.equal(url.searchParams.has('daily'), false);
});

test('Set Practice rejects missing sets and unsupported modes', () => {
  assert.throws(() => practiceLaunchUrl({ setId: '', mode: 'top3', seed: 'x' }), /requires a set/i);
  assert.throws(() => practiceLaunchUrl({ setId: 'msh', mode: 'draft', seed: 'x' }), /unsupported practice mode/i);
});
