'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guard the principles, not a screenshot pixel-for-pixel contract.
// iOS and Android share this React Native implementation.
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const style = (file, name) => {
  const text = read(file);
  const match = text.match(new RegExp('\\b' + name + ':\\s*\\{([^}]*)\\}'));
  assert.ok(match, file + ' must retain ' + name + ' geometry');
  return match[1];
};

test('native tabs have one content heading, a shorter regular tab bar and native safe areas', () => {
  const nav = read('app/(tabs)/_layout.tsx');
  const safe = read('src/components/ScreenArea.tsx');
  assert.match(nav, /headerShown:\s*false/);
  assert.doesNotMatch(nav, /header: \(\{ options \}\)/);
  assert.match(nav, /height: 60 \+ Math\.max\(insets\.bottom, 8\)/);
  assert.match(nav, /AdaptiveTabBar/);
  assert.match(safe, /!header \? \['top' as const\]/);
});

test('Daily is a compact numbered scorecard with a wrapping side action', () => {
  const src = read('src/screens/index.tsx');
  assert.match(src, /dailyCardContent/);
  assert.match(src, /cardIndex/);
  assert.match(src, /String\(index \+ 1\)\.padStart\(2, '0'\)/);
  assert.match(style('src/screens/index.tsx', 'dailyCardContent'), /flexDirection: 'row'/);
  assert.match(style('src/screens/index.tsx', 'dailyCardContent'), /flexWrap: 'wrap'/);
  assert.match(style('src/screens/index.tsx', 'dailyCardCopy'), /minWidth: 150/);
  assert.match(style('src/screens/index.tsx', 'dailyButton'), /minWidth: 92/);
  assert.match(style('src/screens/index.tsx', 'dailyButton'), /flexGrow: 1/);
  assert.match(style('src/screens/index.tsx', 'cubeAccent'), /#976822/);
  assert.match(style('src/screens/index.tsx', 'latestAccent'), /#8c4b36/);
  assert.match(style('src/screens/index.tsx', 'primaryButton'), /minHeight: 48/);
  assert.match(style('src/screens/index.tsx', 'secondaryButton'), /minHeight: 48/);
  assert.match(style('src/screens/index.tsx', 'statusStrip'), /flexWrap: 'wrap'/);
  assert.match(src, /Free · No account required/);
  assert.match(src, /View result/);
  assert.doesNotMatch(style('src/screens/index.tsx', 'completeCard'), /opacity:/);
});

test('playing and grading preserve cards, progress, fixed action and touch size', () => {
  const draft = read('app/draft-run.tsx');
  assert.match(draft, /<Progress run=\{run\}/);
  assert.match(draft, /style=\{styles\.actionDock\}/);
  assert.match(draft, /<Text style=\{styles\.primaryButtonText\}>\{run\.complete \? 'See result' : 'Next pick'\}/);
  assert.match(style('app/draft-run.tsx', 'cardImage'), /aspectRatio: 0\.716/);
  assert.match(style('app/draft-run.tsx', 'grid'), /flexWrap: 'wrap'/);
  assert.match(style('app/draft-run.tsx', 'primaryButton'), /minHeight: 52/);
  assert.match(style('app/draft-run.tsx', 'resultPage'), /paddingTop: spacing\.md/);
  assert.match(style('app/draft-run.tsx', 'scoreBlock'), /padding: spacing\.md/);
  assert.match(draft, /Review pick \$\{index \+ 1\}/);
});

test('app surfaces share phone gutters and keep bounded tablet width', () => {
  const pages = [
    ['src/screens/index.tsx', 860],
    ['src/screens/practice.tsx', 860],
    ['src/screens/learn.tsx', 980],
    ['src/screens/insights.tsx', 980],
    ['src/components/ArticleScreen.tsx', 840],
    ['app/draft-run.tsx', 980],
    ['app/account.tsx', 760],
    ['app/account-profile.tsx', 760],
    ['app/account-reminders.tsx', 760],
    ['app/account-security.tsx', 760],
    ['app/account-delete.tsx', 760],
    ['app/membership.tsx', 760],
    ['app/sets.tsx', 980],
    ['app/set-archive.tsx', 980],
    ['app/shared-run.tsx', 760],
  ];
  for (const [file, max] of pages) {
    const p = style(file, 'page');
    assert.match(p, /padding:\s*spacing\.md/, file + ' should use a 16pt phone gutter');
    assert.match(p, new RegExp('maxWidth\\s*:\\s*' + max), file + ' keeps its readable tablet width');
    assert.match(p, /alignSelf:\s*'center'/);
  }
});

test('content sections avoid excessive stacked cards without reducing form controls', () => {
  for (const file of ['src/screens/practice.tsx', 'src/screens/insights.tsx',
    'app/account.tsx', 'app/account-profile.tsx', 'app/account-security.tsx',
    'app/account-delete.tsx', 'app/membership.tsx', 'app/account-reminders.tsx']) {
    const text = read(file);
    assert.doesNotMatch(style(file, file.includes('practice') ? 'optionCard' :
      file.includes('insights') ? 'section' : 'panel'), /padding: spacing\.lg/);
    assert.match(text, /minHeight:\s*(?:44|45|46|48|50|52|62)/);
  }
  // The November email-reminder parity release removed schedule picker chips.
  // Keep its enable/disable and existing push opt-out controls usable.
  const reminders = read('app/account-reminders.tsx');
  assert.match(style('app/account-reminders.tsx', 'button'), /minHeight:\s*50/);
  assert.match(style('app/account-reminders.tsx', 'secondary'), /minHeight:\s*45/);
  assert.match(reminders, /Previously enabled push reminders/);
  assert.doesNotMatch(reminders, /Enable push on this device/);
  const fonts = read('src/components/Text.tsx');
  assert.doesNotMatch(fonts, /allowFontScaling=\{false\}/);
});

test('simulator readiness uses real screen layout rather than a removed tab header', () => {
  const acceptance = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'native-acceptance.py'), 'utf8');
  assert.match(acceptance, /PACKONE_LEARN_READY/);
  assert.match(acceptance, /PACKONE_LEADERS_READY/);
  assert.match(acceptance, /assert_no_duplicate_tab_header/);
  assert.doesNotMatch(acceptance, /measure_header\(logs\)/);
});
