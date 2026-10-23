import test from 'node:test';
import assert from 'node:assert/strict';
import {describeCpuSummary,summarizeCpuSamples} from '../scripts/ci-neon-compute-sample.mjs';

test('compute samples are weighted by time at each allocation and skip failed reads', () => {
  const summary = summarizeCpuSamples([
    {t: 0, cpus: 1},
    {t: 5000, error: true},
    {t: 60000, cpus: 2},
    {t: 90000, cpus: 1},
    {t: 120000, cpus: 1},
  ]);
  assert.equal(summary.minutes, 2);
  assert.deepEqual(summary.share, {1: 0.75, 2: 0.25});
  assert.equal(summary.mean, 1.25);
  assert.equal(summary.max, 2);
  assert.equal(
    describeCpuSummary(summary, {domain: 'corpus', maxCu: '2'}),
    'Neon compute for corpus (cap 2 CU): 2.0 min sampled; 1 CPU 75%, 2 CPU 25%; peak 2; mean at most 1.25 CU.',
  );
});

test('missing or single compute samples report no allocation instead of failing', () => {
  assert.equal(summarizeCpuSamples([]), null);
  assert.equal(summarizeCpuSamples([{unavailable: true}]), null);
  assert.equal(summarizeCpuSamples([{t: 0, cpus: 1}]), null);
  assert.equal(describeCpuSummary(null, {domain: 'seasons', maxCu: '2'}), 'Neon compute for seasons: no allocation samples.');
});
