import type { NativeAppleSubscriptionStatus } from '@/src/api/apple-subscriptions';
import type { CareerHistoryPage, CareerProfile } from '@/src/api/career';
import type {
  DailyStatus,
  DraftRunAnswer,
  DraftRunCard,
  DraftRunPuzzle,
  DraftRunState,
  PracticeSet,
} from '@/src/api/draftRun';
import type { NativePatreonStatus } from '@/src/api/patreon';

type ScreenshotRequestOptions = {
  method?: string;
  body?: unknown;
};

function card(
  id: string,
  name: string,
  imageUrl: string,
  manaCost = '',
  rarity = 'rare',
  typeLine = '',
): DraftRunCard {
  return {
    id,
    name,
    image_url: imageUrl,
    mana_cost: manaCost,
    rarity,
    type_line: typeLine,
  };
}

// Screenshot fixtures deliberately use direct, source-controlled Scryfall CDN
// URLs already present in Pack One's set archive content. The prior named-card
// API URLs returned redirects and produced blank art in emulator screenshots.
const candidates: DraftRunCard[] = [
  card('hero-in-training', 'Hero in Training', 'https://cards.scryfall.io/normal/front/1/0/105a937b-289c-47b5-96a4-654c697bbb7d.jpg?1783902973'),
  card('web-up', 'Web Up', 'https://cards.scryfall.io/normal/front/9/a/9a1b057b-229c-4f65-ba4e-12dd342238de.jpg?1783902964'),
  card('the-vision', 'The Vision', 'https://cards.scryfall.io/normal/front/2/9/2961cf20-33c8-4e66-9d0f-6daca8ea7880.jpg?1783902887'),
  card('cosmic-cube', 'Cosmic Cube', 'https://cards.scryfall.io/normal/front/d/1/d1cf1ead-fe91-4328-89ab-6d0bc9ff6cbe.jpg?1783902891'),
  card('mighty-thor-jane-foster', 'The Mighty Thor, Jane Foster', 'https://cards.scryfall.io/normal/front/0/8/082cc8cc-bbea-4ca7-a0e8-da1f865d6626.jpg?1783902900'),
];

const priorPicks: DraftRunCard[] = [
  card('rimekin-recluse', 'Rimekin Recluse', 'https://cards.scryfall.io/normal/front/b/a/ba6b5368-3262-4002-bf1e-fce62f7f7901.jpg?1783904483'),
  card('moon-vigil-adherents', 'Moon-Vigil Adherents', 'https://cards.scryfall.io/normal/front/6/0/60621c37-62e1-4261-ae76-3946b4a0cfa3.jpg?1783904429'),
];

function puzzle(index: number): DraftRunPuzzle {
  return {
    puzzle_id: `screenshot-puzzle-${index + 1}`,
    set_id: 'msh',
    pack_number: 1,
    pick_number: index + 6,
    prior_picks: priorPicks,
    candidates,
  };
}

const initialRun: DraftRunState = {
  id: 'screenshot-run',
  environment: 'mixed',
  run_length: 8,
  set_reroll_allowed: false,
  rerolls: { set: 0, pack: 0 },
  day: '2026-09-27',
  revision: 1,
  round: 0,
  complete: false,
  score: null,
  leaderboard_eligible: true,
  ranked_name: 'PackOneReviewer',
  answers: [],
  current: puzzle(0),
  standing: null,
  comparison: null,
};

function feedbackRun(selectedId: string): DraftRunState {
  const current = puzzle(0);
  const selected = current.candidates.find((item) => item.id === selectedId) ?? current.candidates[0];
  const historical = current.candidates.find((item) => item.id === 'web-up');
  if (!selected || !historical) throw new Error('Store screenshot draft fixture is incomplete.');
  const score = selected.id === historical.id ? 100 : selected.id === 'hero-in-training' ? 96 : 78;
  const answer: DraftRunAnswer = {
    score,
    selectedId: selected.id,
    selectedName: selected.name,
    selectedSupport: selected.id === 'hero-in-training' ? 0.46 : 0.24,
    historicalId: historical.id,
    historicalName: historical.name,
    historicalMatch: selected.id === historical.id,
    consensusId: 'hero-in-training',
    consensusName: 'Hero in Training',
    consensusSupport: 0.46,
    consensusRank: selected.id === 'hero-in-training' ? 1 : 2,
    consensusCap: 100,
    supportRatio: selected.id === 'hero-in-training' ? 1 : 0.52,
    pickNumber: current.pick_number,
    modelTargetDisagreement: selected.id !== historical.id,
    ranking: [
      { id: 'hero-in-training', name: 'Hero in Training', support: 0.46, score: 100 },
      { id: 'web-up', name: 'Web Up', support: 0.24, score: 96 },
      { id: 'the-vision', name: 'The Vision', support: 0.11, score: 84 },
      { id: 'cosmic-cube', name: 'Cosmic Cube', support: 0.08, score: 79 },
    ],
    puzzle: current,
  };
  return {
    ...initialRun,
    revision: 2,
    round: 1,
    answers: [answer],
    current: puzzle(1),
  };
}

const dailyStatus: DailyStatus = {
  day: '2026-09-27',
  capabilities: ['account', 'unlimited_regular_practice', 'unlimited_cube_practice', 'custom_corpus'],
  player: { claimed: true },
  membership: {
    connected: true,
    capabilities: ['unlimited_cube_practice', 'custom_corpus'],
  },
  ranking_identity: { eligible: true, reason: null },
  daily_streak: 12,
  daily_history: [],
};

const practiceSets: PracticeSet[] = [
  { set_id: 'eoe', set_name: 'Edge of Eternities', release_date: '2025-08-01', regular_run: true },
  { set_id: 'tdm', set_name: 'Tarkir: Dragonstorm', release_date: '2025-04-11', regular_run: true },
  { set_id: 'fin', set_name: 'FINAL FANTASY', release_date: '2025-06-13', regular_run: true },
  { set_id: 'dft', set_name: 'Aetherdrift', release_date: '2025-02-14', regular_run: true },
];

const membershipStatus: NativePatreonStatus = {
  configured: true,
  connected: false,
  ad_free: true,
  ads_allowed: false,
  capabilities: ['account', 'unlimited_regular_practice'],
  account_capabilities: ['account', 'unlimited_regular_practice'],
  account_user_id: '22222222-2222-4222-8222-222222222222',
  player_id: '11111111-1111-4111-8111-111111111111',
  checked_at: '2026-09-27T18:00:00.000Z',
  membership: null,
};

const appleStatus: NativeAppleSubscriptionStatus = {
  configured: true,
  product_id: 'pro.packone.app.elite.monthly',
  subscription: {
    linked: false,
    active: false,
    provider: 'apple-app-store',
    productId: 'pro.packone.app.elite.monthly',
    status: 'unknown',
    expiresAt: null,
    autoRenewEnabled: null,
    environment: 'Sandbox',
  },
  account_capabilities: ['account', 'unlimited_regular_practice'],
  checked_at: '2026-09-27T18:00:00.000Z',
};

const careerProfile: CareerProfile = {
  player: {
    display_name: 'PackOneReviewer',
    profile_key: 'a1b2c3d4e5f60718',
    profile_public: true,
    favorite_set_id: 'powered-cube',
    showcase_achievement: 'daily-streak-10',
    claimed: true,
    username_owned: true,
  },
  summary: {
    games: 184,
    average_score: 86.4,
    best_score: 100,
    challenge_wins: 19,
    challenge_losses: 8,
    challenge_ties: 2,
    daily_games: 73,
    environments_played: 14,
    current_streak: 12,
    best_streak: 21,
  },
  environment_total: 14,
  by_set: [
    { set_id: 'powered-cube', games: 48, average_score: 91.2, best_score: 100, daily_games: 17, last_played_at: '2026-09-27T17:00:00.000Z' },
    { set_id: 'eoe', games: 31, average_score: 88.7, best_score: 100, daily_games: 13, last_played_at: '2026-09-26T17:00:00.000Z' },
    { set_id: 'tdm', games: 26, average_score: 85.8, best_score: 99, daily_games: 10, last_played_at: '2026-09-25T17:00:00.000Z' },
  ],
  by_mode: [
    { mode: 'draft_run', games: 184, average_score: 86.4, best_score: 100 },
  ],
  best_environments: [
    { set_id: 'powered-cube', games: 48, average_score: 91.2, best_score: 100, daily_games: 17 },
    { set_id: 'eoe', games: 31, average_score: 88.7, best_score: 100, daily_games: 13 },
    { set_id: 'tdm', games: 26, average_score: 85.8, best_score: 99, daily_games: 10 },
  ],
  cube: { set_id: 'powered-cube', games: 48, average_score: 91.2, best_score: 100, daily_games: 17 },
  best_final_percentile: 4,
  current_season: {
    id: 'season-2026-09',
    set_id: 'eoe',
    name: 'September',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    standings: [
      { environment: 'mixed', rank: 37, average: 91.4, days: 22 },
      { environment: 'powered-cube', rank: 18, average: 94.1, days: 19 },
    ],
  },
  daily_history: [
    { date: '2026-09-26', set_id: 'mixed', mode: 'draft_run', score: 94, grade: 'A', rank: 37, total: 2418, percentile: 2, final: true },
    { date: '2026-09-25', set_id: 'powered-cube', mode: 'draft_run', score: 97, grade: 'A+', rank: 18, total: 1620, percentile: 2, final: true },
  ],
  recent: [
    { cursor: 'recent-1', played_at: '2026-09-27T17:00:00.000Z', set_id: 'powered-cube', mode: 'draft_run', score: 96, grade: 'A+', is_daily: false, outcome: null },
    { cursor: 'recent-2', played_at: '2026-09-26T17:00:00.000Z', set_id: 'mixed', mode: 'draft_run', score: 94, grade: 'A', is_daily: true, outcome: null },
  ],
  trend: [
    { played_at: '2026-09-24T17:00:00.000Z', score: 88, set_id: 'eoe', mode: 'draft_run' },
    { played_at: '2026-09-25T17:00:00.000Z', score: 91, set_id: 'powered-cube', mode: 'draft_run' },
    { played_at: '2026-09-26T17:00:00.000Z', score: 94, set_id: 'mixed', mode: 'draft_run' },
    { played_at: '2026-09-27T17:00:00.000Z', score: 96, set_id: 'powered-cube', mode: 'draft_run' },
  ],
  achievements: [
    { id: 'daily-streak-10', label: 'Ten-Day Run', description: 'Play a Daily ten days in a row.', unlocked: true, current: 12, target: 10, progress_text: '12-day streak', earned_at: '2026-09-25T17:00:00.000Z' },
    { id: 'perfect-run', label: 'Perfect Draft', description: 'Score 100 on a Draft Run.', unlocked: true, current: 1, target: 1, progress_text: 'Unlocked', earned_at: '2026-09-18T17:00:00.000Z' },
    { id: 'century', label: 'Century Club', description: 'Complete 100 Pack One games.', unlocked: true, current: 184, target: 100, progress_text: '184 games', earned_at: '2026-08-14T17:00:00.000Z' },
  ],
};

const historyPage: CareerHistoryPage = {
  rows: careerProfile.recent,
  next_cursor: null,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseBody(options: ScreenshotRequestOptions): Record<string, unknown> {
  return options.body && typeof options.body === 'object' ? options.body as Record<string, unknown> : {};
}

export async function requestScreenshotFixture<T>(
  path: string,
  options: ScreenshotRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';

  if (path === '/growth/v1/session' && method === 'POST') {
    return {
      token: 'p1_11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      playerId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Pack One Reviewer',
      profileKey: 'a1b2c3d4e5f60718',
    } as T;
  }
  if (path === '/draft/v1/daily-status') return clone(dailyStatus) as T;
  if (path === '/draft/v1/capabilities') {
    return { capabilities: ['account', 'unlimited_regular_practice', 'unlimited_cube_practice', 'custom_corpus'] } as T;
  }
  if (path === '/draft/v1/set-catalog' || path === '/draft/v1/practice-sets') {
    return { sets: clone(practiceSets) } as T;
  }
  if (path === '/draft/v1/runs' && method === 'POST') return clone(initialRun) as T;
  if (path === '/draft/v1/runs/screenshot-run') return clone(initialRun) as T;
  if (path === '/draft/v1/runs/screenshot-run/pick' && method === 'POST') {
    const selected = String(parseBody(options).cardId || 'hero-in-training');
    return clone(feedbackRun(selected)) as T;
  }
  if (path === '/draft/v1/runs/screenshot-run/reroll' && method === 'POST') return clone(initialRun) as T;
  if (path === '/draft/v1/runs/screenshot-run/share' && method === 'POST') return { id: '0123456789abcdef01234567' } as T;
  if (path === '/growth/v1/patreon/mobile/status') return clone(membershipStatus) as T;
  if (path === '/growth/v1/apple-subscriptions/mobile/status') return clone(appleStatus) as T;
  if (path === '/growth/v1/mobile/profile/me') return clone(careerProfile) as T;
  if (path.startsWith('/growth/v1/mobile/profile/history?')) return clone(historyPage) as T;
  if (path === '/draft/health?quick=1') {
    return { ok: true, service: 'draft-run', release: 'screenshot-fixtures', run_length: 8 } as T;
  }

  throw new Error(`No store screenshot fixture is defined for ${method} ${path}.`);
}
