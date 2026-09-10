export function catalogEnvironments(catalog) {
  return (catalog?.sets || [])
    .filter((entry) => entry?.id && !entry.is_fixture)
    .map((entry) => ({
      id: String(entry.id),
      name: String(entry.name || entry.id).trim(),
      isCube: entry.id === 'powered-cube',
      dataDate: entry.data_date || null,
    }));
}

export function environmentProgress(catalog, bySet = []) {
  const stats = new Map((bySet || []).map((row) => [String(row.set_id || row.name || '').toLowerCase(), row]));
  const environments = catalogEnvironments(catalog).map((entry) => {
    const row = stats.get(entry.id.toLowerCase());
    return {
      ...entry,
      played: Number(row?.games || 0) > 0,
      games: Number(row?.games || 0),
      averageScore: Number(row?.average_score || 0),
      bestScore: Number(row?.best_score || 0),
      dailyGames: Number(row?.daily_games || 0),
      lastPlayedAt: row?.last_played_at || null,
    };
  });
  return {
    environments,
    total: environments.length,
    played: environments.filter((entry) => entry.played).length,
  };
}

export function modeName(mode, { cube = false } = {}) {
  if (mode === 'top3') return 'Top 3';
  if (mode === 'full') return cube ? 'Cube Pack Run' : 'Full Pack';
  if (mode === 'draft_run') return cube ? 'Powered Cube Run' : 'Draft Run';
  return String(mode || 'Game');
}

export function unlockedAchievements(profile) {
  return (profile?.achievements || []).filter((achievement) => achievement?.unlocked);
}

export function bestPercentile(profile) {
  if(Number(profile?.best_final_percentile)>0) return Number(profile.best_final_percentile);
  const values = (profile?.daily_history || [])
    .filter(row=>row.final!==false)
    .map((row) => Number(row.percentile))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : null;
}

export function formatChallengeRecord(summary = {}) {
  const wins = Number(summary.challenge_wins || 0);
  const losses = Number(summary.challenge_losses || 0);
  const ties = Number(summary.challenge_ties || 0);
  return `${wins}–${losses}${ties ? `–${ties}` : ''}`;
}

export function recentForm(profile, count = 10) {
  const scores = (profile?.trend || [])
    .slice(-Math.max(1, Number(count) || 10))
    .map((row) => Number(row.score))
    .filter(Number.isFinite);
  if (!scores.length) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function profileShareSummary(profile, progress) {
  const summary = profile?.summary || {};
  const best = (profile?.best_environments || []).slice(0, 3).map((row) => String(row.set_id || '').toUpperCase());
  return {
    name: profile?.player?.display_name || 'Pack Player',
    games: Number(summary.games || 0),
    average: Number(summary.average_score || 0),
    best: Number(summary.best_score || 0),
    streak: Number(summary.current_streak || 0),
    environmentsPlayed: Number(progress?.played || 0),
    environmentTotal: Number(progress?.total || 0),
    bestEnvironments: best,
  };
}
