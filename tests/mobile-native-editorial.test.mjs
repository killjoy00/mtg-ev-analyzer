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

function webSections(html) {
  const prose = html.match(/<div class="prose">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const sections = [];
  for (const match of prose.matchAll(/<(h[23]|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const value = decodeText(match[2]);
    if (match[1] === 'p') {
      assert.ok(sections.length, 'legal paragraph must belong to a heading');
      sections.at(-1).body.push(value);
    } else {
      sections.push({ title: value, body: [] });
    }
  }
  return sections;
}

function nativeSections(exportName, nextExportName) {
  const start = nativeEditorial.indexOf(`export const ${exportName}`);
  assert.notEqual(start, -1, `${exportName} must exist`);
  const end = nextExportName
    ? nativeEditorial.indexOf(`export const ${nextExportName}`, start + 1)
    : nativeEditorial.length;
  const block = nativeEditorial.slice(start, end === -1 ? nativeEditorial.length : end);
  return [...block.matchAll(/\{\s*title:\s*(['"])(.*?)\1,\s*body:\s*\[([\s\S]*?)\]\s*,?\s*\}/g)]
    .map((match) => ({
      title: match[2],
      body: [...match[3].matchAll(/(['"])(.*?)\1\s*,?/g)].map((bodyMatch) => bodyMatch[2]),
    }));
}

test('native editorial heading structure stays aligned with canonical web pages', () => {
  assert.deepEqual(
    nativeSections('aboutSections', 'supportSections').map(({ title }) => title),
    webSections(aboutWeb).map(({ title }) => title),
  );
  assert.deepEqual(
    nativeSections('supportSections', 'privacySections').map(({ title }) => title),
    webSections(contactWeb).map(({ title }) => title),
  );
});

test('native Privacy and Terms legal sections match canonical web text exactly', () => {
  assert.deepEqual(nativeSections('privacySections', 'termsSections'), webSections(privacyWeb));
  assert.deepEqual(nativeSections('termsSections'), webSections(termsWeb));
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
  assert.match(termsScreen, /config\.screenshots\.fixtures && params\.licenses === '1'/);
  assert.match(termsScreen, /const \[licensesOpen, setLicensesOpen\] = useState\(false\)/);
  assert.match(termsScreen, /const licensesVisible = previewLicensesOpen \|\| licensesOpen/);
  assert.match(termsScreen, /scrollToEnd=\{previewLicensesOpen\}/);
  assert.match(termsScreen, /title}>Font licenses<\/Text>/);
  assert.match(termsScreen, /fontLicenses\.map/);
  assert.doesNotMatch(privacyScreen, /fontLicenses/);
});

test('Help is removed from tab headers and About is at the bottom of tab content', () => {
  assert.doesNotMatch(tabLayout, /Help and information|router\.push\('\/help'\)|>Help</);
  for (const [name, source] of [
    ['Home', homeScreen],
    ['Learn', learnScreen],
    ['How to Play', howToScreen],
    ['Account/Sign in', accountScreen],
  ]) {
    assert.match(source, /<AboutLink \/>/, `${name} should expose About at the bottom of its content`);
  }
  assert.equal((practiceScreen.match(/<AboutLink \/>/g) || []).length, 4, 'Practice keeps About in loading, signed-out, error, and ready states');
  assert.equal((leaderboardScreen.match(/<AboutLink \/>/g) || []).length, 3, 'Leaders keeps About in loading, error, and ready states');
  assert.equal((careerScreen.match(/<AboutLink \/>/g) || []).length, 2, 'My Pack One keeps About in signed-out/error/loading and ready states');
  assert.doesNotMatch(accountScreen, /Help & information|router\.push\('\/help'\)/);
});

test('public editorial URLs resolve to native routes', () => {
  assert.match(linking, /if \(normalized === '\/about'\) return '\/about'/);
  assert.match(linking, /if \(normalized === '\/help'\) return '\/about'/);
  assert.doesNotMatch(linking, /['"]\/help['"],/);
  assert.match(linking, /if \(normalized === '\/contact'\) return '\/support'/);
  assert.match(linking, /if \(normalized === '\/privacy'\) return '\/privacy'/);
  assert.match(linking, /if \(normalized === '\/terms'\) return '\/terms'/);
});
