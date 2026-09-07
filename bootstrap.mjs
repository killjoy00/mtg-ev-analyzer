const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');
const runtime = await import('./replay-runtime.mjs');
runtime.installReplayRuntime();
const product = await import('./product.mjs');
const flow = await import('./flow-fixes.mjs');
const humanCopy = await import('./human-copy.mjs');
const growth = await import('./growth.mjs');
const retention = await import('./retention.mjs');

if (challengeMode) {
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  humanCopy.installHumanCopy();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
} else {
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  humanCopy.installHumanCopy();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
}
