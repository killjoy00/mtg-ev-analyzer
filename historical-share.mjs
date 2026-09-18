// Compatibility reader for previously published Full Pack / Top 3 links only.
// No current navigation launches this module.
export async function installHistoricalShare() {
  const { installReplayDataWarmup } = await import('./replay-data.mjs');
  installReplayDataWarmup();
  await import('./social.mjs');
  const layers = [
    ['practice-product.mjs', 'installPracticeProductLayer'],
    ['product.mjs', 'installProductLayer'],
    ['legacy-product.mjs', 'installLegacyCohortLayer'],
    ['leaderboard-product.mjs', 'installLeaderboardProductLayer'],
    ['flow-fixes.mjs', 'installFlowFixes'],
    ['growth.mjs', 'installGrowthLayer'],
    ['historical-growth.mjs', 'installHistoricalGrowthLayer'],
    ['retention.mjs', 'installRetentionLayer'],
    ['profile-product.mjs', 'installProfileProductLayer'],
  ];
  for (const [file, install] of layers) await (await import(`./${file}`))[install]();
}
