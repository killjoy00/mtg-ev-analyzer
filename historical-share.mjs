// Compatibility reader for previously published Full Pack / Top 3 links only.
// No current navigation launches this module.
export async function installHistoricalShare() {
  const { installReplayDataWarmup } = await import('./replay-data.mjs');
  installReplayDataWarmup();
  await import('./social.mjs');
  const layers = [
    ['product.mjs', 'installProductLayer'],
    ['legacy-product.mjs', 'installLegacyCohortLayer'],
    ['leaderboard-product.mjs', 'installLeaderboardProductLayer'],
    ['flow-fixes.mjs', 'installFlowFixes'],
    ['growth.mjs?v=10', 'installGrowthLayer'],
    ['historical-growth.mjs', 'installHistoricalGrowthLayer'],
    ['retention.mjs', 'installRetentionLayer'],
    ['profile-product.mjs?v=10', 'installProfileProductLayer'],
  ];
  for (const [file, install] of layers) await (await import(`./${file}`))[install]();
}
