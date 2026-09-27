import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  draftApi,
  draftScreen,
  leaderboardApi,
  leaderboardScreen,
  linking,
  howToScreen,
  scoringScreen,
  accountScreen,
  webHowTo,
  webScoring,
] = await Promise.all([
  readFile(new URL('../mobile/src/api/draftRun.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/draft-run.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/api/leaderboard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/leaderboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/linking.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/how-to.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/scoring.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../how-it-works/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../scoring/index.html', import.meta.url), 'utf8'),
]);

test('native Draft Run keeps web feedback and result-review parity', () => {
  assert.match(draftApi, /DraftRunRanking/);
  assert.match(draftApi, /consensusSupport/);
  assert.match(draftApi, /modelTargetDisagreement/);
  assert.match(draftApi, /createDraftRunShare/);
  assert.match(draftScreen, /Why this score\?/);
  assert.match(draftScreen, /Review the pack/);
  assert.match(draftScreen, /Model&apos;s strongest choice/);
  assert.match(draftScreen, /Compare all/);
  assert.match(draftScreen, /Your \{run\.run_length\} picks/);
  assert.match(draftScreen, /shared=\$\{/);
  assert.match(draftScreen, /🟩/);
  assert.match(draftScreen, /Play this run and compare/);
});

test('native leaderboard uses current competitive season semantics', () => {
  assert.match(leaderboardApi, /'daily' \| 'week' \| 'season' \| 'all'/);
  assert.doesNotMatch(leaderboardApi, /'month'/);
  assert.match(leaderboardScreen, /This season/);
  assert.match(leaderboardScreen, /Season ·/);
  assert.doesNotMatch(leaderboardScreen, /label: 'Month'/);
  assert.match(linking, /requestedPeriod === 'month' \? 'season'/);
  assert.match(linking, /canonicalPeriod/);
});


function normalizeMarkupText(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

test('native instructional copy preserves current web Daily eligibility semantics', () => {
  const webHowToText = normalizeMarkupText(webHowTo);
  const webScoringText = normalizeMarkupText(webScoring);
  const dailyIntro = 'Pack One has three fixed Daily challenges.';
  const guestValidation = 'an eligible guest can also sign in or link the completed first attempt on the same Pacific date to validate it for the leaderboard';

  assert.ok(webHowToText.includes(dailyIntro));
  assert.ok(howToScreen.includes(dailyIntro));
  assert.ok(webHowToText.includes(guestValidation));
  assert.ok(howToScreen.includes(guestValidation));

  assert.ok(webScoringText.includes(guestValidation));
  assert.ok(scoringScreen.includes(guestValidation));
  assert.doesNotMatch(scoringScreen, /requires an authenticated account when starting/);

  assert.match(leaderboardScreen, /validated to an eligible account/);
  assert.doesNotMatch(leaderboardScreen, /signed-in Pack One Daily runs/);
  assert.match(accountScreen, /web, iPhone, iPad, and Android/);
});
