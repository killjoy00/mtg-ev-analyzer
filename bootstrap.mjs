const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');
const product = await import('./product.mjs');
const flow = await import('./flow-fixes.mjs');
const humanCopy = await import('./human-copy.mjs');

if (challengeMode) {
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  humanCopy.installHumanCopy();
} else {
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  product.installProductLayer();
  flow.installFlowFixes();
  humanCopy.installHumanCopy();
}