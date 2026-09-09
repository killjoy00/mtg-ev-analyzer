import { installRenderLifecycle } from './render-lifecycle.mjs';
import { installReplayDataWarmup } from './replay-data.mjs';

const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');

installRenderLifecycle();
installReplayDataWarmup();

const practice = await import('./practice-product.mjs');
const product = await import('./product.mjs');
const poweredCube = await import('./cube-product.mjs');
const leaderboardProduct = await import('./leaderboard-product.mjs');
const flow = await import('./flow-fixes.mjs');
const growth = await import('./growth.mjs');
const retention = await import('./retention.mjs');

if (challengeMode) {
  await import('./social.mjs');
  practice.installPracticeProductLayer();
  product.installProductLayer();
  poweredCube.installPoweredCubeLayer();
  leaderboardProduct.installLeaderboardProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
} else {
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  practice.installPracticeProductLayer();
  product.installProductLayer();
  poweredCube.installPoweredCubeLayer();
  leaderboardProduct.installLeaderboardProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
}
