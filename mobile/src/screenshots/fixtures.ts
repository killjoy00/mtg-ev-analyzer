import * as SecureStore from '@/src/screenshots/storage';
import { pacificDay } from '@/src/dailyClock';
import { config } from '@/src/config';
import { readScreenshotSession, screenshotSession } from '@/src/screenshots/session';
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
  id: '33333333-3333-4333-8333-333333333333',
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
  const score = selected.id === historical.id ? 100 : selected.id === 'cosmic-cube' ? 0 : selected.id === 'hero-in-training' ? 96 : 78;
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

const SCENARIO_KEY = 'packone.preview.scenario.v1';
const RUN_KEY = 'packone.preview.run.v1';
export async function configureScreenshotScenario(scenario: string) {
  if (!config.screenshots.fixtures) throw new Error('Acceptance fixtures are disabled.');
  await SecureStore.setItemAsync(SCENARIO_KEY, scenario);
  await SecureStore.deleteItemAsync(RUN_KEY);
  await SecureStore.deleteItemAsync('packone.mobile.shared-run.v1');
  await SecureStore.deleteItemAsync('packone.mobile.practice.idempotency.v2');
}

export async function requestScreenshotFixture<T>(
  path: string,
  options: ScreenshotRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const scenario = await SecureStore.getItemAsync(SCENARIO_KEY) || 'elite';
  const currentSession = await readScreenshotSession();
  const guest = !currentSession.accountToken;
  const elite = scenario === 'elite';
  const today = pacificDay();
  const readRun = async () => {
    const saved = await SecureStore.getItemAsync(RUN_KEY);
    return saved ? JSON.parse(saved) as DraftRunState : { ...clone(initialRun), day: today };
  };
  if (path === '/growth/v1/mobile/account/session') return {
    user: currentSession.accountUser || screenshotSession.accountUser,
    session: {}, credentials: { password: true, google: false, apple: false },
    deletion: { enabled: true, available: true, method: 'password' },
  } as T;
  if (path === '/growth/v1/mobile/account/signin' && method === 'POST') {
    const second = parseBody(options).email === 'second@packone.example';
    return {
      user: second ? { id: '55555555-5555-4555-8555-555555555555', email: 'second@packone.example', name: 'Second Reviewer' } : screenshotSession.accountUser,
      session: { token: second ? 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' : screenshotSession.accountToken, expiresAt: screenshotSession.accountExpiresAt },
      linked: { token: screenshotSession.playerToken, playerId: screenshotSession.subjectId, displayName: second ? 'SecondReviewer' : 'PackOneReviewer', newlyClaimed: false, rankingIdentity: { eligible: true } },
    } as T;
  }
  if (path === '/growth/v1/mobile/account/signout') return { ok: true } as T;
  if (path.startsWith('/draft/v1/leaderboard?')) return {
    period: 'daily', environment: 'mixed', start: today, today,
    rows: [{ rank: 1, score: 94, days: 3, display_name: 'A Very Long Pack One Player Name', profile_key: 'a1b2c3d4e5f60718' }],
  } as T;

  if (path === '/growth/v1/session' && method === 'POST') {
    return {
      token: 'p1_11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      playerId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Pack One Reviewer',
      profileKey: 'a1b2c3d4e5f60718',
    } as T;
  }
  if (path === '/draft/v1/daily-status') {
    if (scenario.includes('checking')) await new Promise(resolve => setTimeout(resolve, 30000));
    if (scenario.includes('error')) throw new Error('Controlled offline fixture.');
    const run = await readRun();
    const environments = scenario.includes('all') ? ['mixed', 'powered-cube', 'latest'] : scenario.includes('partial') || run.complete ? ['mixed'] : [];
    return { ...clone(dailyStatus), day: today, player: { claimed: !guest }, daily_streak: scenario.includes('zero') || guest ? 0 : 12,
      daily_history: environments.map(set_id => ({ date: today, set_id, mode: 'draft_run', score: run.complete ? run.score : 87 })) } as T;
  }
  if (path === '/draft/v1/capabilities') {
    return { capabilities: elite ? ['account', 'unlimited_regular_practice', 'unlimited_cube_practice', 'custom_corpus'] : ['account', 'unlimited_regular_practice'] } as T;
  }
  if (path === '/draft/v1/set-catalog' || path === '/draft/v1/practice-sets') {
    return { sets: clone(practiceSets) } as T;
  }
  if (path === '/draft/v1/runs' && method === 'POST') {
    const run = await readRun();
    const body = parseBody(options);
    run.day = body.daily === true ? today : null;
    await SecureStore.setItemAsync(RUN_KEY, JSON.stringify(run));
    console.info('PACKONE_RUN', JSON.stringify({ method: 'POST', id: run.id, round: run.round, shared: Boolean(body.challenge) }));
    return run as T;
  }
  if (path === '/draft/v1/runs/33333333-3333-4333-8333-333333333333') {
    const run = await readRun();
    console.info('PACKONE_RUN', JSON.stringify({ method: 'GET', id: run.id, round: run.round }));
    return run as T;
  }
  if (path === '/draft/v1/shared-runs/aaaaaaaaaaaaaaaaaaaaaaaa') return { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Fixture Drafter', score: 88, scores: [], run_length: 8, environment: 'mixed', source_run_id: '44444444-4444-4444-8444-444444444444' } as T;
  if (path === '/draft/v1/runs/33333333-3333-4333-8333-333333333333/pick' && method === 'POST') {
    const old = await readRun();
    const selected = scenario.includes('match') ? 'web-up' : scenario.includes('zero') ? 'cosmic-cube' : String(parseBody(options).cardId || 'hero-in-training');
    const next = feedbackRun(selected);
    const answer = next.answers[0]!;
    if (scenario.includes('long')) {
      answer.selectedName = 'Bala Ged Recovery // Bala Ged Sanctuary';
      answer.historicalName = 'Esika, God of the Tree // The Prismatic Bridge';
      for (const card of answer.puzzle.candidates) {
        if (card.id === answer.selectedId) card.name = answer.selectedName;
        if (card.id === answer.historicalId) card.name = answer.historicalName;
      }
    }
    if (scenario.includes('image-error')) {
      for (const card of answer.puzzle.candidates) card.image_url = 'data:image/png;base64,broken';
    }
    next.answers = [...old.answers, answer];
    next.round = next.answers.length;
    next.revision = old.revision + 1;
    next.day = old.day;
    next.complete = next.answers.length >= 8;
    next.score = next.complete ? Math.round(next.answers.reduce((sum, answer) => sum + answer.score, 0) / 8) : null;
    next.current = next.complete ? null : puzzle(next.round);
    await SecureStore.setItemAsync(RUN_KEY, JSON.stringify(next));
    return clone(next) as T;
  }
  if (path === '/draft/v1/runs/33333333-3333-4333-8333-333333333333/reroll' && method === 'POST') return clone(initialRun) as T;
  if (path === '/draft/v1/runs/33333333-3333-4333-8333-333333333333/share' && method === 'POST') return { id: '0123456789abcdef01234567' } as T;
  if (path === '/growth/v1/patreon/mobile/status') return clone(membershipStatus) as T;
  if (path === '/growth/v1/apple-subscriptions/mobile/status') return clone(appleStatus) as T;
  if (path === '/growth/v1/mobile/profile/me' || path === '/growth/v1/mobile/profile/a1b2c3d4e5f60718') {
    const profile = clone(careerProfile);
    if (currentSession.accountUser?.email === 'second@packone.example') profile.player.display_name = 'SecondReviewer';
    if (scenario === 'member-new') { profile.summary.games = 0; profile.recent = []; }
    return profile as T;
  }
  if (path.startsWith('/growth/v1/mobile/profile/history?')) return clone(historyPage) as T;
  if (path === '/draft/health?quick=1') {
    return { ok: true, service: 'draft-run', release: 'screenshot-fixtures', run_length: 8 } as T;
  }

  throw new Error(`No store screenshot fixture is defined for ${method} ${path}.`);
}
