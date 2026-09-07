const params = new URLSearchParams(window.location.search);
const challengeMode = params.has('challenge');

if (challengeMode) {
  await import('./social.mjs');
} else {
  await import('./app.js');
  await import('./social.mjs');
}
