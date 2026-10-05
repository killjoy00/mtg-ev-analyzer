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
  accountProfileScreen,
  accountSecurityScreen,
  accountDeleteScreen,
  accountStateHook,
  accountLayout,
  homeScreen,
  publicProfileScreen,
  webHowTo,
  webScoring,
] = await Promise.all([
  readFile(new URL('../mobile/src/api/draftRun.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/draft-run.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/api/leaderboard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/leaderboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/linking.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/how-to.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/scoring.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account-profile.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account-security.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account-delete.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/hooks/useAccountState.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/_layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/index.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/profile.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../how-it-works/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../scoring/index.html', import.meta.url), 'utf8'),
]);

test('native Draft Run keeps web feedback and result-review parity', () => {
  assert.match(draftApi, /DraftRunRanking/);
  assert.match(draftApi, /consensusSupport/);
  assert.match(draftApi, /modelTargetDisagreement/);
  assert.match(draftApi, /createDraftRunShare/);
  assert.match(draftApi, /submitDraftRunDecisionReport/);
  assert.match(draftApi, /\/report/);
  assert.match(draftScreen, /Why this score\?/);
  assert.match(draftScreen, /Review the pack/);
  assert.match(draftScreen, /Report this decision/);
  assert.match(draftScreen, /What seems wrong\?/);
  assert.match(draftScreen, /Draft context looks wrong/);
  assert.match(draftScreen, /Card or image issue/);
  assert.match(draftScreen, /Score \/ recommendation seems wrong/);
  assert.match(draftScreen, /Something is broken/);
  assert.match(draftScreen, /Anything else\?/);
  assert.match(draftScreen, /Thanks \\u2014 report sent\./);
  assert.match(draftApi, /Application\.nativeApplicationVersion/);
  assert.match(draftApi, /Application\.nativeBuildVersion/);
  assert.match(draftApi, /native\.Platform\.OS === 'ios'/);
  assert.match(draftApi, /import\('expo-application'\)/);
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
  const howToGuestValidation = 'an eligible guest can also sign in or link the completed first attempt on the same Pacific date to validate it for the leaderboard';
  const scoringGuestValidation = 'an eligible guest can sign in or link that completed first attempt on the same Pacific date to validate it for the leaderboard';

  assert.ok(webHowToText.includes(dailyIntro));
  assert.ok(howToScreen.includes(dailyIntro));
  assert.ok(webHowToText.includes(howToGuestValidation));
  assert.ok(howToScreen.includes(howToGuestValidation));

  assert.ok(webScoringText.includes(scoringGuestValidation));
  assert.ok(scoringScreen.includes(scoringGuestValidation));
  assert.doesNotMatch(scoringScreen, /requires an authenticated account when starting/);

  assert.match(leaderboardScreen, /validated to an eligible account/);
  assert.doesNotMatch(leaderboardScreen, /signed-in Pack One Daily runs/);
  assert.match(accountScreen, /web, iPhone, iPad, and Android/);
});


test('native Account keeps auth on /account and splits signed-in management into flat routes', () => {
  assert.match(accountScreen, /Profile &amp; visibility/);
  assert.match(accountScreen, /router\.push\('\/account-profile'\)/);
  assert.match(accountScreen, /router\.push\('\/membership'\)/);
  assert.match(accountScreen, /router\.push\('\/account-security'\)/);
  assert.match(accountScreen, /router\.push\('\/account-delete'\)/);
  assert.match(accountProfileScreen, /Shown on Daily leaderboards and your public profile\./);
  assert.match(accountSecurityScreen, /Changing your password signs out every device\./);
  assert.match(accountDeleteScreen, /Deleting your Pack One account does not cancel subscriptions\./);
  assert.match(accountStateHook, /useFocusEffect/);
  assert.match(accountStateHook, /generation\.current/);
  assert.match(accountLayout, /name="account-profile" options=\{\{ title: 'Profile & visibility' \}\}/);
  assert.match(accountLayout, /name="account-security" options=\{\{ title: 'Sign-in & security' \}\}/);
  assert.match(accountLayout, /name="account-delete" options=\{\{ title: 'Delete account' \}\}/);
  assert.match(homeScreen, /name_not_allowed/);
  assert.match(homeScreen, /That display name is not allowed\. Choose another to join Daily leaderboards\./);
  assert.match(homeScreen, /Choose a different display name\. That one is already taken\./);
  assert.match(accountProfileScreen, /if \(!account \|\| !profile\)/);
  assert.match(accountSecurityScreen, /if \(!account\)/);
  assert.match(accountDeleteScreen, /if \(!account\)/);
  assert.match(accountProfileScreen, />Retry</);
  assert.match(accountSecurityScreen, />Retry</);
  assert.match(accountDeleteScreen, />Retry</);
  assert.match(accountProfileScreen, /onPress=\{\(\) => void refresh\(\)\}/);
  assert.match(accountSecurityScreen, /onPress=\{\(\) => void refresh\(\)\}/);
  assert.match(accountDeleteScreen, /onPress=\{\(\) => void refresh\(\)\}/);
  assert.match(accountStateHook, /clearEnrichment\(\);\n\s+setMessage\(error instanceof Error/);
  assert.equal((publicProfileScreen.match(/router\.replace\(\{\s*pathname: '\/account'/g)||[]).length,2);
  assert.match(publicProfileScreen, /pendingActionShown=useRef\(false\)/);
});
