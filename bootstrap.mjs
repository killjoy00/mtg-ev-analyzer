import { installRenderLifecycle } from './render-lifecycle.mjs';
import { installReplayDataWarmup } from './replay-data.mjs';

const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');

installRenderLifecycle();
installReplayDataWarmup();

const product = await import('./product.mjs');
const flow = await import('./flow-fixes.mjs');
const growth = await import('./growth.mjs');
const retention = await import('./retention.mjs');

if (challengeMode) {
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
} else {
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
}
