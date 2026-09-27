const APPLE_ELITE_PRODUCT_ID = 'pro.packone.app.elite.monthly';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PLAYER_TOKEN = 'p1_' + PLAYER_ID + '.' + 'A'.repeat(43);
const ACCOUNT_TOKEN = 'B'.repeat(43);

export const screenshotSession = Object.freeze({
  playerToken: PLAYER_TOKEN,
  subjectId: PLAYER_ID,
  accountToken: ACCOUNT_TOKEN,
  accountExpiresAt: '2030-01-01T00:00:00.000Z',
  accountUser: Object.freeze({
    id: ACCOUNT_ID,
    email: 'reviewer@packone.pro',
    name: 'Pack Player',
  }),
});

type ScreenshotRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

type Card = {
  id: string;
  name: string;
  image_url: string;
};

const card = (id: string, name: string): Card => ({
  id,
  name,
  image_url: 'https://api.scryfall.com/cards/named?format=image&version=normal&exact=' + encodeURIComponent(name),
});

const cards = [
  card('lightning-bolt', 'Lightning Bolt'),
  card('counterspell', 'Counterspell'),
  card('swords-to-plowshares', 'Swords to Plowshares'),
  card('sol-ring', 'Sol Ring'),
  card('birds-of-paradise', 'Birds of Paradise'),
  card('dark-ritual', 'Dark Ritual'),
];

const previousCards = [
  card('serra-angel', 'Serra Angel'),
  card('llanowar-elves', 'Llanowar Elves'),
];

function puzzle(round = 0) {
  return {
    puzzle_id: 'screenshot-puzzle-' + String(round + 1).padStart(2, '0'),
    set_id: round === 0 ? 'cube' : 'eoe',
    pack_number: 1,
    pick_number: round + 1,
    prior_picks: round === 0 ? previousCards : [previousCards[0], cards[3]],
    candidates: cards,
  };
}

function initialRun(environment = 'mixed', daily = true) {
  return {
    id: 'screenshot-run-001',
    environment,
    run_length: 8,
    set_reroll_allowed: false,
    custom_set_ids: [],
    rerolls: { set: 0, pack: 0 },
    day: daily ? '2026-09-27' : null,
    revision: 1,
    round: 0,
    complete: false,
    score: null,
    leaderboard_eligible: daily,
    ranked_name: 'Pack Player',
    answers: [],
    current: puzzle(0),
    standing: null,
    comparison: null,
  };
}

function revealedRun(selectedId: string) {
  const first = initialRun();
  const selected = cards.find((item) => item.id === selectedId) || cards[0];
  const trophy = cards[3];
  const ranking = [
    { id: trophy.id, name: trophy.name, support: 0.31, score: 100 },
    { id: selected.id, name: selected.name, support: 0.28, score: selected.id === trophy.id ? 100 : 91 },
    { id: cards[1].id, name: cards[1].name, support: 0.19, score: 72 },
  ];
  const answer = {
    score: selected.id === trophy.id ? 100 : 91,
    selectedId: selected.id,
    selectedName: selected.name,
    selectedSupport: selected.id === trophy.id ? 0.31 : 0.28,
    historicalId: trophy.id,
    historicalName: trophy.name,
    historicalMatch: selected.id === trophy.id,
    consensusId: trophy.id,
    consensusName: trophy.name,
    consensusSupport: 0.31,
    consensusRank: 1,
    consensusCap: 95,
    supportRatio: selected.id === trophy.id ? 1 : 0.9,
    pickNumber: 1,
    modelTargetDisagreement: false,
    ranking,
    puzzle: puzzle(0),
  };
  return {
    ...first,
    revision: 2,
    round: 1,
    answers: [answer],
    current: puzzle(1),
  };
}

let currentRun: unknown = initialRun();

const dailyStatus = {
  day: '2026-09-27',
  capabilities: ['account', 'unlimited_regular_practice'],
  player: { claimed: true },
  membership: { connected: false, capabilities: [] },
  ranking_identity: { eligible: true, reason: null },
  daily_streak: 12,
  daily_history: [],
};

const patreonStatus = {
  configured: true,
  connected: false,
  ad_free: true,
  ads_allowed: false,
  capabilities: [],
  account_capabilities: ['account', 'unlimited_regular_practice'],
  account_user_id: ACCOUNT_ID,
  player_id: PLAYER_ID,
  checked_at: '2026-09-27T18:00:00.000Z',
  membership: null,
};

const appleStatus = {
  configured: true,
  product_id: APPLE_ELITE_PRODUCT_ID,
  subscription: {
    linked: true,
    active: false,
    provider: 'apple-app-store',
    productId: APPLE_ELITE_PRODUCT_ID,
    status: 'expired',
    expiresAt: null,
    autoRenewEnabled: false,
    environment: 'Sandbox',
  },
  account_capabilities: ['account', 'unlimited_regular_practice'],
  checked_at: '2026-09-27T18:00:00.000Z',
};

const practiceSets = {
  sets: [
    { set_id: 'eoe', set_name: 'Edge of Eternities', release_date: '2025-08-01', regular_run: true },
    { set_id: 'fin', set_name: 'FINAL FANTASY', release_date: '2025-06-13', regular_run: true },
    { set_id: 'tdm', set_name: 'Tarkir: Dragonstorm', release_date: '2025-04-11', regular_run: true },
    { set_id: 'dft', set_name: 'Aetherdrift', release_date: '2025-02-14', regular_run: true },
  ],
};

const careerProfile = {
  player: {
    display_name: 'Pack Player',
    profile_key: '0123456789abcdef',
    profile_public: true,
    favorite_set_id: 'eoe',
    showcase_achievement: 'daily_streak_7',
    claimed: true,
    username_owned: true,
  },
  summary: {
    games: 184,
    average_score: 82.6,
    best_score: 100,
    challenge_wins: 9,
    challenge_losses: 4,
    challenge_ties: 1,
    daily_games: 67,
    environments_played: 18,
    current_streak: 12,
    best_streak: 21,
  },
  environment_total: 31,
  by_set: [
    { set_id: 'eoe', games: 24, average_score: 86.4, best_score: 100, daily_games: 9, last_played_at: '2026-09-27T12:00:00.000Z' },
    { set_id: 'tdm', games: 19, average_score: 84.1, best_score: 98, daily_games: 8, last_played_at: '2026-09-25T12:00:00.000Z' },
  ],
  by_mode: [{ mode: 'draft_run', games: 184, average_score: 82.6, best_score: 100 }],
  best_environments: [
    { set_id: 'eoe', games: 24, average_score: 86.4, best_score: 100, daily_games: 9 },
    { set_id: 'powered-cube', games: 16, average_score: 85.2, best_score: 99, daily_games: 7 },
    { set_id: 'tdm', games: 19, average_score: 84.1, best_score: 98, daily_games: 8 },
  ],
  cube: { set_id: 'powered-cube', games: 16, average_score: 85.2, best_score: 99, daily_games: 7 },
  best_final_percentile: 4,
  current_season: {
    id: 'season-2026-09',
    set_id: 'eoe',
    name: 'Edge of Eternities',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    standings: [
      { environment: 'mixed', rank: 14, average: 87.1, days: 18 },
      { environment: 'powered-cube', rank: 9, average: 89.4, days: 16 },
      { environment: 'latest', rank: 21, average: 84.8, days: 17 },
    ],
  },
  daily_history: [
    { date: '2026-09-26', set_id: 'mixed', mode: 'draft_run', score: 91, grade: 'A', rank: 14, total: 482, percentile: 3, final: true },
    { date: '2026-09-25', set_id: 'powered-cube', mode: 'draft_run', score: 88, grade: 'A-', rank: 27, total: 451, percentile: 6, final: true },
  ],
  recent: [],
  trend: [
    { played_at: '2026-09-27T12:00:00.000Z', score: 91, set_id: 'eoe', mode: 'draft_run' },
    { played_at: '2026-09-26T12:00:00.000Z', score: 88, set_id: 'powered-cube', mode: 'draft_run' },
    { played_at: '2026-09-25T12:00:00.000Z', score: 84, set_id: 'tdm', mode: 'draft_run' },
    { played_at: '2026-09-24T12:00:00.000Z', score: 93, set_id: 'fin', mode: 'draft_run' },
  ],
  achievements: [
    { id: 'daily_streak_7', label: 'Seven-day streak', description: 'Complete a Daily seven days in a row.', unlocked: true, current: 12, target: 7, progress_text: '12 day streak', earned_at: '2026-09-20T12:00:00.000Z' },
    { id: 'century', label: 'Century', description: 'Complete 100 Pack One games.', unlocked: true, current: 184, target: 100, progress_text: '184 / 100', earned_at: '2026-08-15T12:00:00.000Z' },
    { id: 'archive_25', label: 'Archive explorer', description: 'Play 25 Pack One environments.', unlocked: false, current: 18, target: 25, progress_text: '18 / 25', earned_at: null },
  ],
};

const history = {
  rows: [
    { cursor: 'h1', played_at: '2026-09-27T12:00:00.000Z', set_id: 'eoe', mode: 'draft_run', score: 91, grade: 'A', is_daily: true, outcome: null },
    { cursor: 'h2', played_at: '2026-09-26T12:00:00.000Z', set_id: 'powered-cube', mode: 'draft_run', score: 88, grade: 'A-', is_daily: true, outcome: null },
    { cursor: 'h3', played_at: '2026-09-25T12:00:00.000Z', set_id: 'tdm', mode: 'draft_run', score: 84, grade: 'B+', is_daily: false, outcome: 'Win' },
  ],
  next_cursor: null,
};

export async function screenshotRequestJson<T>(
  path: string,
  options: ScreenshotRequestOptions = {},
): Promise<T> {
  const method = options.method || 'GET';

  if (path === '/growth/v1/patreon/mobile/status' && method === 'GET') return patreonStatus as T;
  if (path === '/growth/v1/apple-subscriptions/mobile/status' && method === 'GET') return appleStatus as T;
  if (path === '/draft/v1/daily-status' && method === 'GET') return dailyStatus as T;
  if (path === '/draft/v1/capabilities' && method === 'GET') {
    return { capabilities: ['account', 'unlimited_regular_practice', 'unlimited_cube_practice', 'custom_corpus'] } as T;
  }
  if (path === '/draft/v1/practice-sets' && method === 'GET') return practiceSets as T;
  if (path === '/draft/v1/set-catalog' && method === 'GET') return practiceSets as T;
  if (path === '/growth/v1/mobile/profile/me' && method === 'GET') return careerProfile as T;
  if (path.startsWith('/growth/v1/mobile/profile/history?') && method === 'GET') return history as T;

  if (path === '/draft/v1/runs' && method === 'POST') {
    const body = (options.body && typeof options.body === 'object') ? options.body as Record<string, unknown> : {};
    const environment = body.environment === 'powered-cube' ? 'powered-cube' : body.environment === 'latest' ? 'latest' : 'mixed';
    currentRun = initialRun(environment, body.daily !== false);
    return currentRun as T;
  }

  if (path === '/draft/v1/runs/screenshot-run-001/pick' && method === 'POST') {
    const body = (options.body && typeof options.body === 'object') ? options.body as Record<string, unknown> : {};
    currentRun = revealedRun(typeof body.cardId === 'string' ? body.cardId : cards[0].id);
    return currentRun as T;
  }

  if (path === '/draft/v1/runs/screenshot-run-001' && method === 'GET') return currentRun as T;

  throw new Error('Screenshot fixture has no response for ' + method + ' ' + path + '. Add an explicit fixture instead of using live network data.');
}
