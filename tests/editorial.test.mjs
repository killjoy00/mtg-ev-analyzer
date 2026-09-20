import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = ['index.html','how-it-works/index.html','scoring/index.html','methodology/index.html','learn/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/index.html','sets/msh/index.html','sets/sos/index.html','sets/tmt/index.html','sets/ecl/index.html','about/index.html','contact/index.html','privacy/index.html','terms/index.html','disclosure/index.html'];
for (const path of pages) {
  const html = await readFile(path, 'utf8');
  assert.match(html, /<meta name="description"/i, `${path} needs a description`);
  assert.match(html, /rel="canonical"/i, `${path} needs a canonical`);
  assert.doesNotMatch(html, /lorem ipsum/i, `${path} must not contain filler`);
  assert.doesNotMatch(html, /site-nav-menu|top-nav-menu/i, `${path} must not hide Method behind a dropdown`);
  assert.match(html, /class="brand-mark"[^>]*><span>P<\/span><sup>1<\/sup>/i, `${path} needs the shared P1 mark`);
}
for (const path of ['how-it-works/index.html','scoring/index.html','methodology/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/msh/index.html']) {
  const html = await readFile(path, 'utf8');
  const words = html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 330, `${path} is too thin for the editorial shell: ${words} words`);
}
const home = await readFile('index.html','utf8');
assert.doesNotMatch(home, /id="home-editorial"/);
assert.doesNotMatch(home, /data-ad-slot="home"/);
assert.match(home, /href="\/how-it-works\/"[^>]*>How To Play\?<\/a>/);
assert.doesNotMatch(home, /href="\/methodology\/"[^>]*>Method<\/a>/);
assert.match(home, /class="topbar"/);
assert.match(home, /id="daily-nav"[^>]*>Daily Run<\/button>/);
assert.match(home, /id="leaderboard-nav"[^>]*>Leaders<\/button>/);
assert.match(home, /<main id="app" class="app"><\/main>/, 'the app shell should not announce every full-page rerender as a live region');
assert.match(home, /Impact-Site-Verification: 3e227a68-dfc4-4be8-a619-b13df4f67e25/);
assert.doesNotMatch(home, /impact-site-verification'\s+value=/i);
const howTo = await readFile('how-it-works/index.html','utf8');
assert.match(howTo, /<h1>How to Play Pack One<\/h1>/);
assert.match(howTo, /class="topbar"/);
assert.match(howTo, />Daily Run<\/a>/);
assert.match(howTo, />Leaders<\/a>/);
assert.match(howTo, />How To Play\?<\/a>/);
assert.match(howTo, /id="account-nav" href="\/\?account=1">Account<\/a>/);
assert.match(howTo, /<h2>Scoring<\/h2>/);
assert.match(howTo, /href="\/scoring\/">View scoring<\/a>/);
assert.match(howTo, /<h2>Method<\/h2>/);
assert.match(howTo, /href="\/methodology\/">View method<\/a>/);
assert.match(howTo, /<h2>Sets<\/h2>/);
assert.match(howTo, /href="\/sets\/">View sets<\/a>/);
const staticTopbarPages = [
  'how-it-works/index.html',
  'scoring/index.html',
  'methodology/index.html',
  'learn/index.html',
  'learn/first-pick-discipline/index.html',
  'learn/reading-consensus/index.html',
  'learn/staying-open/index.html',
  'sets/index.html',
  'sets/msh/index.html',
  'sets/sos/index.html',
  'sets/tmt/index.html',
  'sets/ecl/index.html',
  'about/index.html',
  'contact/index.html',
  'disclosure/index.html',
  'privacy/index.html',
  'terms/index.html',
  'admin/index.html'
];
for (const path of staticTopbarPages) {
  const html = await readFile(path, 'utf8');
  assert.match(html, /href="\/visual-c\.css\?v=2"/, `${path} needs the app header styles`);
  assert.match(html, /class="topbar"/, `${path} needs the standard app topbar`);
  assert.match(html, /href="\/\?game=draft-run&daily=1">Daily Run<\/a>/, `${path} needs Daily Run navigation`);
  assert.match(html, /href="\/\?game=draft-run&board=daily">Leaders<\/a>/, `${path} needs Leaders navigation`);
  assert.match(html, /href="\/how-it-works\/"[^>]*>How To Play\?<\/a>/, `${path} needs How To Play navigation`);
  assert.match(html, /id="account-nav" href="\/\?account=1">Account<\/a>/, `${path} needs Account navigation`);
  assert.doesNotMatch(html, /class="site-header"|class="admin-brand"/, `${path} must not use a legacy top-level header`);
}
for (const path of ['about/index.html','contact/index.html','disclosure/index.html','privacy/index.html','terms/index.html']) {
  const html = await readFile(path, 'utf8');
  assert.doesNotMatch(html, /Make the decision before you read the answer\./, `${path} should not use the coaching CTA`);
  assert.match(html, /class="article-return"[^>]*>[\s\S]*Back to Pack One/, `${path} needs a quiet return to the product`);
}
const bootstrap = await readFile('bootstrap.mjs','utf8');
assert.match(bootstrap, /else if \(params\.has\('account'\)\)[\s\S]*?await profiles\.renderMyProfile\(\)/);
const about = await readFile('about/index.html','utf8');
assert.match(about, /Three Dailies, ready to play/);
assert.match(about, /Daily Draft Run, Daily Powered Cube, and Daily Latest Set/);
const contact = await readFile('contact/index.html','utf8');
assert.match(contact, /mailto:partner@packone\.pro/);
assert.match(contact, /mailto:admin@packone\.pro/);
const method = await readFile('methodology/index.html','utf8');
assert.doesNotMatch(method, /class="method-directory"/);
assert.match(method, /Some 3-0 Traditional trophy drafts are also used/);
assert.match(method, /Traditional drafts supply eligible puzzle decisions, not model-training evidence/);
const sets = await readFile('sets/index.html','utf8');
assert.match(sets, /id="set-archive-grid"/);
assert.match(sets, /\/sets\/catalog\.mjs/);
const setCatalog = await readFile('sets/catalog.mjs','utf8');
assert.match(sets, /leaderboard-config\.js/);
assert.match(setCatalog, /v1\/set-catalog/);
assert.match(setCatalog, /verified_decisions/);
assert.doesNotMatch(setCatalog, /replay seats/);
assert.doesNotMatch(sets, /custom=1/);
assert.doesNotMatch(setCatalog, /custom=1/);
assert.match(setCatalog, /Play Draft Run/);
const admin = await readFile('admin/index.html','utf8');
assert.match(admin, /class="brand-mark"[^>]*><span>P<\/span><sup>1<\/sup>/i);
const ads = await readFile('ad-config.js','utf8');
assert.match(ads, /enabled:\s*false/);
const tcg = await readFile('tcgplayer.mjs','utf8');
assert.match(tcg, /rel = 'sponsored noopener'/);
assert.match(tcg, /tcgplayer_click/);
const tcgConfig = await readFile('tcgplayer-config.js','utf8');
assert.match(tcgConfig, /partner\.tcgplayer\.com\/c\/7742974\/1780961\/21018\?u=\{url\}/);
assert.doesNotMatch(tcgConfig, /impactDeepLinkTemplate:\\s*''/);
const disclosure = await readFile('disclosure/index.html','utf8');
assert.match(disclosure, /participates in TCGplayer's affiliate program through Impact/i);
assert.match(disclosure, /commission/i);
assert.doesNotMatch(disclosure, /preparing to participate|When affiliate routing is active/i);
assert.doesNotMatch(disclosure, /How links are labeled/i);
const privacy = await readFile('privacy/index.html','utf8');
assert.match(privacy, /TCGplayer links on Pack One are affiliate links routed through Pack One's approved Impact referral URL/i);
assert.match(privacy, /may earn a commission from eligible purchases at no added cost to the buyer/i);
assert.doesNotMatch(privacy, /may be affiliate links|whether affiliate routing was active/i);
const sitemap = await readFile('sitemap.xml','utf8');
assert.match(sitemap, /\/sets\/msh\//);
assert.match(sitemap, /\/learn\/first-pick-discipline\//);
console.log('Editorial and monetization shell guardrails passed.');
