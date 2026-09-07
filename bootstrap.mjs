const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');

if (challengeMode) {
  await import('./social.mjs');
} else {
  const product = await import('./product.mjs');
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  product.installProductLayer();
}
