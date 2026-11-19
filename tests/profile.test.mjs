import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestPercentile,
  catalogEnvironments,
  environmentProgress,
  liveEnvironmentProgress,
  formatChallengeRecord,
  challengeOutcomeLabel,
  profileShareSummary,
  recentForm,
  unlockedAchievements,
} from '../profile-core.mjs';

test('environment progress is catalog driven and includes special modes', () => {
  const catalog = { sets: [
    { id:'neo', name:'NEO' },
    { id:'vow', name:'VOW' },
    { id:'powered-cube', name:'Powered Cube', category:'special_mode' },
  ] };
  const bySet = [
    { set_id:'neo', games:4, average_score:81.5, best_score:96 },
    { set_id:'powered-cube', games:1, average_score:73, best_score:73 },
  ];
  assert.deepEqual(catalogEnvironments(catalog).map((row)=>row.id), ['neo','vow','powered-cube']);
  const progress = environmentProgress(catalog, bySet);
  assert.equal(progress.total, 3);
  assert.equal(progress.played, 2);
  assert.equal(progress.environments.find((row)=>row.id==='vow').played, false);
  assert.equal(progress.environments.find((row)=>row.id==='powered-cube').isCube, true);
});

test('live coverage excludes non-live archive sets but preserves historical progress', () => {
  const catalog = { sets: [
    { id: 'neo' }, { id: 'pio' }, { id: 'sir' }, { id: 'powered-cube' },
  ] };
  const bySet = [
    { set_id: 'neo', games: 4 },
    { set_id: 'pio', games: 2 },
    { set_id: 'sir', games: 0 },
    { set_id: 'powered-cube', games: 1 },
  ];
  const archive = environmentProgress(catalog, bySet);
  const live = liveEnvironmentProgress({ sets: [
    { set_id: 'neo' }, { set_id: 'powered-cube' },
  ] }, bySet);
  assert.deepEqual({ played: archive.played, total: archive.total }, { played: 3, total: 4 });
  assert.deepEqual({ played: live.played, total: live.total }, { played: 2, total: 2 });
  assert.equal(live.ids.has('pio'), false);
  assert.deepEqual(live.environments.map(entry => entry.id), ['neo','powered-cube']);
  assert.equal(live.environments[0].games, 4);
  assert.equal(live.environments[0].played, true);
  assert.equal(live.environments[1].isCube, true);
  assert.equal(liveEnvironmentProgress(null, bySet), null);
  assert.equal(liveEnvironmentProgress({ sets: [] }, bySet), null);
  assert.equal(liveEnvironmentProgress({ sets: [{ set_id: 'neo' }, { set_id: 'neo' }] }, bySet), null);
  assert.equal(liveEnvironmentProgress({ sets: [{ set_id: '__bad' }] }, bySet), null);
});

test('profile percentile history uses the strongest final percentile', () => {
  assert.equal(bestPercentile({ daily_history:[{ percentile:18 },{ percentile:7 },{ percentile:null },{ percentile:32 }] }), 7);
  assert.equal(bestPercentile({ daily_history:[] }), null);
});

test('profile helpers summarize challenges, recent form, unlocks, and share copy', () => {
  const profile = {
    player:{ display_name:'Drafter' },
    summary:{ games:12, average_score:78.25, best_score:99, current_streak:4, challenge_wins:3, challenge_losses:2, challenge_ties:1 },
    trend:[{ score:70 },{ score:80 },{ score:90 }],
    best_environments:[{ set_id:'neo' },{ set_id:'ktk' }],
    achievements:[{ id:'a', unlocked:true },{ id:'b', unlocked:false }],
  };
  assert.equal(formatChallengeRecord(profile.summary), '3 beaten · 2 below target · 1 tied');
  assert.equal(formatChallengeRecord({challenge_wins:2,challenge_losses:1}), '2 beaten · 1 below target · 0 tied');
  assert.equal(formatChallengeRecord(), '0 beaten · 0 below target · 0 tied');
  assert.equal(challengeOutcomeLabel('win'), 'Beat shared score');
  assert.equal(challengeOutcomeLabel('loss'), 'Below shared score');
  assert.equal(challengeOutcomeLabel('tie'), 'Matched shared score');
  assert.equal(challengeOutcomeLabel(null), '');
  assert.equal(recentForm(profile, 2), 85);
  assert.deepEqual(unlockedAchievements(profile).map((row)=>row.id), ['a']);
  assert.deepEqual(profileShareSummary(profile, { played:5, total:32 }), {
    name:'Drafter', games:12, average:78.25, best:99, streak:4,
    environmentsPlayed:5, environmentTotal:32, bestEnvironments:['NEO','KTK'],
  });
});
