import { installRenderLifecycle } from './render-lifecycle.mjs';
import { installReplayDataWarmup } from './replay-data.mjs';

const params = new URLSearchParams(window.location.search);
// Older Cube launch links now enter the dedicated trophy game. Stored legacy
// friend links remain readable through their original challenge contract.
if(params.get('set')==='powered-cube' && !params.has('challenge') && params.get('game')!=='draft-run') {
  params.set('game','draft-run');params.delete('mode');params.delete('seed');
  history.replaceState({},'',`${location.pathname}?${params}`);
}
const challengeMode = params.has('challenge');

installRenderLifecycle();
installReplayDataWarmup();

const practice = await import('./practice-product.mjs');
const product = await import('./product.mjs');
const poweredCube = await import('./cube-product.mjs');
const legacyCohort = await import('./legacy-product.mjs');
const leaderboardProduct = await import('./leaderboard-product.mjs');
const flow = await import('./flow-fixes.mjs');
const growth = await import('./growth.mjs');
const retention = await import('./retention.mjs');
const profiles = await import('./profile-product.mjs');
const draftRun = await import('./draft-run-product.mjs');
const progression = await import('./progression.mjs');
const homeProduct = await import('./home-product.mjs');

if (params.get('game') === 'draft-run') {
  await growth.installGrowthLayer();
  profiles.installProfileProductLayer();
  progression.installProgression();
  await draftRun.installDraftRunPage();
} else if (challengeMode) {
  await import('./social.mjs');
  practice.installPracticeProductLayer();
  product.installProductLayer();
  poweredCube.installPoweredCubeLayer();
  legacyCohort.installLegacyCohortLayer();
  leaderboardProduct.installLeaderboardProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
  profiles.installProfileProductLayer();
  progression.installProgression();
} else {
  const seed = params.get('seed');
  if (seed) product.seedGameRandom(seed);
  await import('./app.js');
  await import('./social.mjs');
  practice.installPracticeProductLayer();
  product.installProductLayer();
  poweredCube.installPoweredCubeLayer();
  legacyCohort.installLegacyCohortLayer();
  leaderboardProduct.installLeaderboardProductLayer();
  flow.installFlowFixes();
  await growth.installGrowthLayer();
  retention.installRetentionLayer();
  profiles.installProfileProductLayer();
  draftRun.installDraftRunHome();
  progression.installProgression();
  homeProduct.installHomeProductLayer();
}
