import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
  aboutWeb,
  contactWeb,
  privacyWeb,
  termsWeb,
  nativeEditorial,
  aboutScreen,
  supportScreen,
  privacyScreen,
  termsScreen,
  helpScreen,
  tabLayout,
  homeScreen,
  practiceScreen,
  leaderboardScreen,
  learnScreen,
  howToScreen,
  careerScreen,
  accountScreen,
  linking,
] = await Promise.all([
  readFile(new URL('../about/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../contact/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../privacy/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../terms/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/nativeEditorial.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/about.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/support.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/privacy.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/terms.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/help.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/(tabs)/_layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/index.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/practice.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/leaderboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/learn.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/how-to.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/career.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/app/account.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/linking.ts', import.meta.url), 'utf8'),
]);

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function webHeadings(html) {
  return [...html.matchAll(/<h[23](?:\s[^>]*)?>([\s\S]*?)<\/h[23]>/g)]
    .map((match) => decodeText(match[1]));
}

function nativeTitles(exportName, nextExportName) {
  const start = nativeEditorial.indexOf(`export const ${exportName}`);
  assert.notEqual(start, -1, `${exportName} must exist`);
  const end = nextExportName
    ? nativeEditorial.indexOf(`export const ${nextExportName}`, start + 1)
    : nativeEditorial.length;
  const block = nativeEditorial.slice(start, end === -1 ? nativeEditorial.length : end);
  return [...block.matchAll(/title:\s*'([^']+)'/g)].map((match) => match[1]);
}

test('native editorial heading structure stays aligned with canonical web pages', () => {
  assert.deepEqual(nativeTitles('aboutSections', 'supportSections'), webHeadings(aboutWeb));
  assert.deepEqual(nativeTitles('supportSections', 'privacySections'), webHeadings(contactWeb));
  assert.deepEqual(nativeTitles('privacySections', 'termsSections'), webHeadings(privacyWeb));
  assert.deepEqual(nativeTitles('termsSections'), webHeadings(termsWeb));
});

test('About preserves attribution and routes to native Support, Privacy, and Terms', () => {
  assert.match(nativeEditorial, /17Lands public draft data under CC BY 4\.0/);
  assert.match(nativeEditorial, /unofficial Fan Content permitted under the Fan Content Policy/);
  assert.match(nativeEditorial, /©Wizards of the Coast LLC/);
  assert.match(aboutScreen, /route: '\/support'/);
  assert.match(aboutScreen, /route: '\/privacy'/);
  assert.match(aboutScreen, /route: '\/terms'/);
  assert.doesNotMatch(aboutScreen, /WebBrowser/);
});

test('Support uses working native email actions', () => {
  assert.match(supportScreen, /mailto:\$\{address\}/);
  assert.match(supportScreen, /admin@packone\.pro/);
  assert.match(supportScreen, /partner@packone\.pro/);
  assert.doesNotMatch(supportScreen, /WebBrowser/);
});

test('legacy Help redirects to About and font licenses live only at the end of Terms', () => {
  assert.match(helpScreen, /<Redirect href="\/about" \/>/);
  assert.doesNotMatch(helpScreen, /fontLicenses|WebBrowser|Font licenses/);
  assert.match(termsScreen, /const \[licensesOpen, setLicensesOpen\] = useState\(false\)/);
  assert.match(termsScreen, /title}>Font licenses<\/Text>/);
  assert.match(termsScreen, /fontLicenses\.map/);
  assert.doesNotMatch(privacyScreen, /fontLicenses/);
});

test('Help is removed from tab headers and About is at the bottom of tab content', () => {
  assert.doesNotMatch(tabLayout, /Help and information|router\.push\('\/help'\)|>Help</);
  for (const [name, source] of [
    ['Home', homeScreen],
    ['Practice', practiceScreen],
    ['Leaders', leaderboardScreen],
    ['Learn', learnScreen],
    ['How to Play', howToScreen],
    ['My Pack One', careerScreen],
    ['Account/Sign in', accountScreen],
  ]) {
    assert.match(source, /<AboutLink \/>/, `${name} should expose About at the bottom of its content`);
  }
  assert.doesNotMatch(accountScreen, /Help & information|router\.push\('\/help'\)/);
});

test('public editorial URLs resolve to native routes', () => {
  assert.match(linking, /if \(normalized === '\/about'\) return '\/about'/);
  assert.match(linking, /if \(normalized === '\/contact'\) return '\/support'/);
  assert.match(linking, /if \(normalized === '\/privacy'\) return '\/privacy'/);
  assert.match(linking, /if \(normalized === '\/terms'\) return '\/terms'/);
});
