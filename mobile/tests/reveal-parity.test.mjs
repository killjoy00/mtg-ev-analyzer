import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// The native app mirrors a few small web modules instead of bundling DOM code.
// These checks run both implementations on the same inputs so the copy, links
// and decisions cannot drift apart silently.
const require = createRequire(import.meta.url);
const { compileModule } = require('./support/compile-module.cjs');
const native = (file) => compileModule(file, {});

const webReveal = await import('../../draft-run-reveal.mjs');
const webFeedback = await import('../../draft-run-feedback.mjs');
const webShare = await import('../../share-cards.mjs');
const webToday = await import('../../today-status.mjs');
const webGuides = await import('../../set-guides.mjs');
const { gameDateKey } = await import('../../game-date.mjs');

const reveal = native('src/reveal.ts');
const drafter = native('src/trophyDrafter.ts');
const share = native('src/dailyShare.ts');
const guides = native('src/setGuides.ts');

const ranking = [
  { id: 'a', name: 'A', support: 0.46, score: 95 },
  { id: 'b', name: 'B', support: 0.24, score: 100 },
  { id: 'c', name: 'C', support: 0.11, score: 70 },
  { id: 'd', name: 'D', support: null, score: 10 },
  { id: 'e', name: 'E', support: 0.05, score: 40 },
];
const answers = [
  { selectedId: 'c', historicalId: 'b', ranking },
  { selectedId: 'b', historicalId: 'b', ranking },
  { selectedId: 'a', historicalId: 'b', ranking },
  { selectedId: 'e', historicalId: 'a', ranking },
  { selectedId: 'a', historicalId: null, ranking },
  { selectedId: 'a', historicalId: 'b', ranking: [] },
];

test('reveal card choices and support labels match draft-run-reveal.mjs', () => {
  for (const answer of answers) assert.deepEqual(reveal.revealCardChoices(answer), webReveal.revealCardChoices(answer));
  for (const [support, leader, trophy] of [[0.24, 0.46, false], [0.46, 0.46, false], [null, 0.46, false], [0.2, 0, false], [0.2, 0.46, true], ['x', 1, false]]) {
    assert.equal(reveal.modelSupportLabel(support, leader, trophy), webReveal.modelSupportLabel(support, leader, trophy));
  }
});

test('reveal sentences match draft-run-feedback.mjs', () => {
  for (const answer of [
    { historicalMatch: true, historicalName: 'B', selectedName: 'B' },
    { historicalMatch: false, historicalName: 'B', selectedName: 'C' },
    { historicalMatch: false, historicalName: null, selectedName: '' },
  ]) {
    assert.equal(reveal.trophyRevealSentence(answer), webFeedback.trophyRevealSentence(answer));
    assert.equal(reveal.compactRevealFeedback(answer), webFeedback.compactDraftRunFeedback(answer));
  }
  const markup = webFeedback.consensusFeedback({ consensusName: 'A', ranking });
  assert.ok(markup.includes(reveal.SCORING_COPY), 'scoring copy');
  assert.ok(markup.includes(reveal.MODEL_NOTE), 'model note');
});

test('trophy drafter facts and sentences match draft-run-feedback.mjs', () => {
  for (const answer of [
    { trophyDrafter: { record: '7–2', winRate: 62, rank: null } },
    { trophyDrafter: { record: '7–0', winRate: null, rank: 'Mythic' } },
    { trophyDrafter: { record: 'bad', winRate: 49, rank: 'Gold' } },
    { trophyRecord: 'went 7–1' },
    { trophyRecord: 'has a 64% win rate' },
    { trophyRecord: 'reached Diamond rank' },
    {},
  ]) {
    const facts = drafter.trophyDrafterFacts(answer);
    assert.deepEqual(facts, webFeedback.trophyDrafterFacts(answer));
    assert.deepEqual(drafter.trophyDrafterSentences(facts), webFeedback.trophyDrafterSentences(facts));
  }
});

const day = '2026-11-07';
const runAnswers = [100, 90, 70, 30, 0, 100, 86, 60].map((score, index) => ({ score, historicalMatch: index === 0 || index === 5 }));
const completeRun = (environment, overrides = {}) => ({ id: `${environment}-run`, environment, day, score: 67, complete: true, run_length: 8, answers: runAnswers, ...overrides });

test('Daily share text and short links match share-cards.mjs', () => {
  for (const environment of ['mixed', 'powered-cube', 'latest', 'unknown']) {
    const run = completeRun(environment);
    assert.equal(share.dailyShareUrl(run), webShare.dailyShareUrl(run));
    assert.equal(share.draftRunShareText(run), webShare.draftRunShareText(run));
    const practice = { ...run, day: null };
    assert.equal(share.draftRunShareText(practice), webShare.draftRunShareText(practice));
  }
  assert.throws(() => share.dailyShareUrl({ day: null, environment: 'mixed' }), /Daily date/);
  assert.equal(share.shareDate(day), webShare.shareDate(day));
  assert.deepEqual(share.pickGrades(runAnswers), webShare.pickGrades(runAnswers));
});

test('the three-Daily share selects and formats runs like share-cards.mjs', () => {
  const history = [
    { date: day, mode: 'draft_run', set_id: 'mixed', run_id: '11111111-1111-4111-8111-111111111111' },
    { date: day, mode: 'draft_run', set_id: 'powered-cube', run_id: '22222222-2222-4222-8222-222222222222' },
    { date: day, mode: 'draft_run', set_id: 'latest', run_id: '33333333-3333-4333-8333-333333333333' },
    { date: '2026-11-06', mode: 'draft_run', set_id: 'latest', run_id: '44444444-4444-4444-8444-444444444444' },
  ];
  for (const current of [{ day, environment: 'latest' }, { day, environment: 'mixed' }, { day: null, environment: 'mixed' }, { day, environment: 'other' }]) {
    assert.deepEqual(share.dailySetRunIds(history, current), webShare.dailySetRunIds(history, current));
  }
  assert.deepEqual(share.dailySetRunIds(history.slice(1), { day, environment: 'latest' }), webShare.dailySetRunIds(history.slice(1), { day, environment: 'latest' }));
  const set = [completeRun('latest'), completeRun('mixed', { score: 80 }), completeRun('powered-cube', { score: 55 })];
  assert.deepEqual(share.dailySetShareRuns(set), webShare.dailySetShareRuns(set));
  assert.equal(share.dailySetShareText(share.dailySetShareRuns(set)), webShare.dailySetShareText(webShare.dailySetShareRuns(set)));
  for (const broken of [set.slice(0, 2), [set[0], set[1], { ...set[2], day: '2026-11-06' }], [set[0], set[1], { ...set[2], complete: false }], [set[0], set[0], set[1]]]) {
    assert.equal(share.dailySetShareRuns(broken), webShare.dailySetShareRuns(broken));
  }
});

test('next unfinished and all-complete Daily checks match today-status.mjs', () => {
  const today = gameDateKey();
  const rows = (environments, date = today) => environments.map((set_id) => ({ date, mode: 'draft_run', set_id, score: 50 }));
  const cases = [
    [{ day: today, daily_history: rows(['mixed']) }, today, 'mixed'],
    [{ day: today, daily_history: rows(['mixed', 'powered-cube']) }, today, 'powered-cube'],
    [{ day: today, daily_history: rows(['mixed', 'latest']) }, today, 'powered-cube'],
    [{ day: today, daily_history: [] }, today, 'latest'],
    [{ day: today, daily_history: rows(['mixed', 'powered-cube', 'latest']) }, today, 'latest'],
    [{ day: '2000-01-01', daily_history: rows(['mixed']) }, today, 'mixed'],
    [{ day: today, daily_history: rows(['mixed']) }, '2000-01-01', 'mixed'],
    [{ day: today }, today, 'mixed'],
    [null, today, 'mixed'],
    [{ day: today, daily_history: rows(['mixed']) }, today, 'other'],
  ];
  for (const [status, completedDay, completedEnvironment] of cases) {
    const options = { completedDay, completedEnvironment };
    assert.equal(share.nextUnfinishedDaily(status, completedDay, completedEnvironment)?.label ?? null,
      webToday.nextUnfinishedDaily(status, options)?.label ?? null, JSON.stringify(options));
    assert.equal(share.completedAllDailies(status, completedDay, completedEnvironment),
      webToday.completedAllDailies(status, options), JSON.stringify(options));
  }
});

test('set refresher coverage matches set-guides.mjs', () => {
  assert.deepEqual([...guides.GUIDE_IDS], [...webGuides.GUIDE_IDS]);
  for (const id of [...webGuides.GUIDE_IDS, 'FRA', 'zzz', '', null]) {
    const path = webGuides.setGuidePath(id);
    assert.equal(guides.setGuideUrl(id), path ? `https://packone.pro${path}` : null);
  }
});
