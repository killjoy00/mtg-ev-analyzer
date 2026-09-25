import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = ['index.html','how-it-works/index.html','scoring/index.html','methodology/index.html','learn/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/index.html','sets/msh/index.html','sets/sos/index.html','sets/tmt/index.html','sets/ecl/index.html','about/index.html','contact/index.html','privacy/index.html','terms/index.html'];
for (const path of pages) {
  const html = await readFile(path, 'utf8');
  assert.match(html, /<meta name="description"/i, `${path} needs a description`);
  assert.match(html, /rel="canonical"/i, `${path} needs a canonical`);
  assert.doesNotMatch(html, /lorem ipsum/i, `${path} must not contain filler`);
  assert.doesNotMatch(html, /site-nav-menu|top-nav-menu/i, `${path} must not hide Method behind a dropdown`);
  assert.match(html, /class="brand-mark"[^>]*><span>P<\/span><sup>1<\/sup>/i, `${path} needs the shared P1 mark`);
  assert.doesNotMatch(html, /href="\/disclosure\/">Disclosure<\/a>/i, `${path} must not expose a standalone Disclosure footer link`);
}
for (const path of ['how-it-works/index.html','scoring/index.html','methodology/index.html','learn/first-pick-discipline/index.html','learn/reading-consensus/index.html','learn/staying-open/index.html','sets/msh/index.html']) {
  const html = await readFile(path, 'utf8');
  const words = html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 330, `${path} is too thin for the editorial shell: ${words} words`);
}
const home = await readFile('index.html','utf8');
assert.doesNotMatch(home, /id="home-editorial"/);
assert.equal((home.match(/data-ad-slot="home"/g)||[]).length,1,'home has exactly one dormant ad slot');
assert.match(home, /<main id="app" class="app"><\/main>\s*<aside class="ad-slot" data-ad-slot="home" hidden aria-label="Advertisement"><\/aside>\s*<\/div>\s*<footer class="site-footer app-footer">/,'home ad slot stays directly after main inside app-shell');
assert.doesNotMatch(home, /googlesyndication/i,'Google loader stays out of index.html');
assert.match(home, /href="visual-c\.css\?v=8"/,'home must bust the CSS cache for the affiliate-banner and mobile-nav styles');
assert.match(home, /id="how-nav"[^>]*href="\/how-it-works\/"[^>]*>How To Play<\/a>/);
assert.doesNotMatch(home, /href="\/methodology\/"[^>]*>Method<\/a>/);
assert.match(home, /class="topbar"/);
assert.match(home, /id="daily-nav"[^>]*>Daily Run<\/button>/);
assert.doesNotMatch(home, /id="leaderboard-nav"[^>]*>Leaders<\/button>/, 'guest home must not expose Leaders before identity resolves');
assert.match(home, /<main id="app" class="app"><\/main>/, 'the app shell should not announce every full-page rerender as a live region');
assert.match(home, /Impact-Site-Verification: 3e227a68-dfc4-4be8-a619-b13df4f67e25/);
assert.doesNotMatch(home, /impact-site-verification'\s+value=/i);
assert.doesNotMatch(home, /Draft data from|No 17Lands endorsement/i, 'home footer should stay visually minimal');
const editorialCss = await readFile('editorial.css','utf8');
assert.match(editorialCss, /body\[data-page="editorial"\]\s*>\s*\.topbar\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*20;/, 'editorial pages should keep the shared header visible while scrolling');
assert.doesNotMatch(home, /<body[^>]*data-page="editorial"/i, 'the gameplay/home shell must not opt into the sticky editorial header');
const howTo = await readFile('how-it-works/index.html','utf8');
assert.match(howTo, /<h1>How to Play Pack One<\/h1>/);
assert.match(howTo, /class="topbar"/);
assert.match(howTo, />Daily Run<\/a>/);
assert.doesNotMatch(howTo, />Leaders<\/a>/, 'guest How To Play nav should stay focused');
assert.match(howTo, />How To Play<\/a>/);
assert.match(howTo, /id="account-nav" href="\/\?account=1">Sign in<\/a>/);
assert.match(howTo, /class="quick-start"/);
assert.match(howTo, /class="quick-start-action"/);
assert.match(howTo, /class="quick-start-action">[\s\S]*href="\/\?game=draft-run&daily=1">Play Daily Draft Run<\/a>[\s\S]*No account required\./);
assert.match(howTo, /No account required/);
assert.match(howTo, /src="\/site-nav\.mjs"/);
assert.match(howTo, /same Pacific date to validate it for the leaderboard/);
assert.match(howTo, /<h2>Scoring<\/h2>/);
assert.match(howTo, /href="\/scoring\/">View scoring<\/a>/);
assert.match(howTo, /<h2>Method<\/h2>/);
assert.match(howTo, /href="\/methodology\/">View method<\/a>/);
assert.match(howTo, /<h2>Sets<\/h2>/);
assert.match(howTo, /href="\/sets\/">View sets<\/a>/);
const publicStaticTopbarPages = [
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
  'privacy/index.html',
  'terms/index.html'
];
for (const path of publicStaticTopbarPages) {
  const html = await readFile(path, 'utf8');
  assert.match(html, /href="\/visual-c\.css\?v=8"/, `${path} needs the refreshed app header styles`);
  assert.match(html, /class="topbar"/, `${path} needs the standard app topbar`);
  assert.match(html, /data-site-nav/, `${path} needs account-aware navigation`);
  assert.match(html, /href="\/\?game=draft-run&daily=1">Daily Run<\/a>/, `${path} needs Daily Run navigation`);
  assert.doesNotMatch(html, /href="\/\?game=draft-run&board=daily">Leaders<\/a>/, `${path} guest markup must not expose Leaders`);
  assert.match(html, /href="\/how-it-works\/"[^>]*>How To Play<\/a>/, `${path} needs How To Play navigation`);
  assert.match(html, /id="account-nav" href="\/\?account=1">Sign in<\/a>/, `${path} needs Sign in navigation`);
  assert.match(html, /src="\/site-nav\.mjs"/, `${path} needs signed-in navigation enhancement`);
  assert.doesNotMatch(html, /class="site-header"|class="admin-brand"/, `${path} must not use a legacy top-level header`);
}
const adminTopbar = await readFile('admin/index.html','utf8');
assert.match(adminTopbar, /href="\/\?game=draft-run&board=daily">Leaders<\/a>/);
assert.match(adminTopbar, /href="\/how-it-works\/"[^>]*>How To Play\?<\/a>/);
for (const path of ['about/index.html','contact/index.html','privacy/index.html','terms/index.html']) {
  const html = await readFile(path, 'utf8');
  assert.doesNotMatch(html, /Make the decision before you read the answer\./, `${path} should not use the coaching CTA`);
  assert.match(html, /class="article-return"[^>]*>[\s\S]*Back to Pack One/, `${path} needs a quiet return to the product`);
}
const siteNav = await readFile('site-nav.mjs','utf8');
assert.match(siteNav, /link\('\/practice\/'\s*,\s*'Practice'/);
assert.match(siteNav, /'Leaders'/);
assert.match(siteNav, /'Learn'/);
assert.match(siteNav, /'My Pack One'/);
assert.match(siteNav, /'How To Play'/);
const dailyHome = await readFile('daily-home.mjs','utf8');
assert.match(dailyHome, /Make your pick, then see what the trophy drafter chose and how strong your pick was\./);
assert.doesNotMatch(dailyHome, /trophy drafter chose —/);
assert.match(dailyHome, /Start here/);
assert.match(dailyHome, /No account required/);
assert.match(dailyHome, /p1-card/);
assert.match(dailyHome, /Eight decisions from Powered Cube trophy drafts\./);
assert.match(dailyHome, /Eight decisions from trophy drafts in the latest set\./);
assert.doesNotMatch(dailyHome, /Free practice|Elite practice|data-home-elite/);
const learnHub = await readFile('learn/index.html','utf8');
assert.match(learnHub, /<h1>Go deeper on Pack One\.<\/h1>/);
assert.match(learnHub, /<h2>How to Play<\/h2>/);
assert.match(learnHub, /<h2>Scoring<\/h2>/);
assert.match(learnHub, /<h2>Method<\/h2>/);
assert.match(learnHub, /<h2>Sets<\/h2>/);
const practiceHub = await readFile('practice/index.html','utf8');
assert.match(practiceHub, /<title>Practice · Pack One<\/title>/);
assert.match(practiceHub, /src="\/practice-page\.mjs"/);
assert.match(practiceHub, /href="\/practice\.css\?v=1"/);
const practicePage = await readFile('practice-page.mjs','utf8');
assert.match(practicePage, /title:'Regular Draft Run'/);
assert.match(practicePage, /title:'Powered Cube'/);
assert.match(practicePage, /title:'Choose your sets'/);
assert.match(practicePage, /unlimited_cube_practice/);
assert.match(practicePage, /custom_corpus/);
assert.doesNotMatch(practicePage, /—/);
assert.doesNotMatch(howTo, /—/);
assert.doesNotMatch(learnHub, /—/);
const bootstrap = await readFile('bootstrap.mjs','utf8');
assert.match(bootstrap, /\['practice-nav','\/practice\/','Practice'\]/);
assert.match(bootstrap, /else if \(params\.has\('account'\)\)[\s\S]*?renderAccount\(\{source:'route'\}\)/);
const about = await readFile('about/index.html','utf8');
assert.match(about, /Three Dailies, ready to play/);
assert.match(about, /Daily Draft Run, Daily Powered Cube, and Daily Latest Set/);
const contact = await readFile('contact/index.html','utf8');
assert.match(contact, /mailto:partner@packone\.pro/);
assert.match(contact, /mailto:admin@packone\.pro/);
assert.doesNotMatch(contact, /keeps advertising outside active gameplay/i);
const scoring = await readFile('scoring/index.html','utf8');
assert.match(scoring, /same Pacific date to validate it for the leaderboard/);
assert.doesNotMatch(scoring, /href="\/scoring\/">View scoring<\/a>/, 'Scoring should not link to itself in related content');
const method = await readFile('methodology/index.html','utf8');
assert.doesNotMatch(method, /class="method-directory"/);
assert.doesNotMatch(method, /href="\/methodology\/">View method<\/a>/, 'Method should not link to itself in related content');
assert.match(method, /Some 3-0 Traditional trophy drafts are also used/);
assert.match(method, /Traditional drafts supply eligible puzzle decisions, not model-training evidence/);
assert.match(method, /See the <a href="\/terms\/">Terms<\/a> for full attribution and source-license information/);
assert.doesNotMatch(method, /No endorsement is implied|card rights remain with their owners/i);
const sets = await readFile('sets/index.html','utf8');
assert.match(sets, /id="set-archive-grid"/);
assert.match(sets, /\/sets\/catalog\.mjs/);
assert.doesNotMatch(sets, /href="\/sets\/">View sets<\/a>/, 'Sets should not link to itself in related content');
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
assert.match(ads, /client:\s*'ca-pub-1217971050094766'/);
assert.match(ads, /home:\s*'1543495960'/);
const homeCss = await readFile('visual-c.css','utf8');
assert.match(homeCss, /\.ad-slot\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
assert.match(homeCss, /\.tcg-affiliate-promo\s*\{/);
assert.match(homeCss, /\.tcg-affiliate-disclosure\s*\{/);
assert.match(homeCss, /\.top-actions\.is-signed-nav #daily-nav,[\s\S]*?\[data-nav="daily"\]\s*\{display:none\}/, 'signed mobile nav should omit redundant Daily Run');
assert.match(homeCss, /@media \(max-width: 760px\)[\s\S]*?\.tcg-affiliate-link\s*\{[\s\S]*?grid-template-columns:\s*96px minmax\(0, 1fr\)/, 'mobile affiliate creative should use the compact two-column layout');
const logoRule=(homeCss.match(/\.tcg-affiliate-logo\s*\{([\s\S]*?)\}/)||[])[1]||'';
assert.match(logoRule, /height:\s*auto/,'TCGplayer logo must retain its supplied aspect ratio');
assert.doesNotMatch(logoRule, /filter|box-shadow|transform|rotate|opacity/i,'TCGplayer logo must not receive visual effects');
const logoAsset = await readFile('assets/tcgplayer-logo-primary-stroke.webp');
assert.ok(logoAsset.length>1000,'official TCGplayer logo asset must be present');
const tcg = await readFile('tcgplayer.mjs','utf8');
assert.match(tcg, /rel = 'sponsored noopener'/);
assert.match(tcg, /tcgplayer_click/);
assert.match(tcg, /categories\/trading-and-collectible-card-games\/magic-the-gathering/);
const adLoader = await readFile('ads.mjs','utf8');
assert.match(adLoader, /dataset\.tcgplayerSurface='daily_home_banner'/);
assert.match(adLoader, /\/assets\/tcgplayer-logo-primary-stroke\.webp/);
assert.match(adLoader, /Affiliate link\. Pack One may earn a commission from purchases\./);
const tcgConfig = await readFile('tcgplayer-config.js','utf8');
assert.match(tcgConfig, /partner\.tcgplayer\.com\/c\/7742974\/1780961\/21018\?u=\{url\}/);
assert.match(tcgConfig, /homeBannerEnabled:\s*true/);
assert.match(tcgConfig, /homeDestination:\s*'https:\/\/www\.tcgplayer\.com\/categories\/trading-and-collectible-card-games\/magic-the-gathering'/);
assert.doesNotMatch(tcgConfig, /impactDeepLinkTemplate:\\s*''/);
const terms = await readFile('terms/index.html','utf8');
assert.match(terms, /id="advertising-and-affiliates"/i);
assert.match(terms, /participates in TCGplayer's affiliate program through Impact/i);
assert.match(terms, /commission/i);
assert.match(terms, /Commerce relationships do not influence consensus support/i);
assert.match(terms, /Display advertising, if enabled/i);
assert.match(terms, /Material model, corpus, selection, and scoring changes are versioned/i);
assert.doesNotMatch(terms, /and versions material model/i);
const disclosureRedirect = await readFile('disclosure/index.html','utf8');
assert.match(disclosureRedirect, /http-equiv="refresh" content="0; url=\/terms\/#advertising-and-affiliates"/i);
assert.match(disclosureRedirect, /rel="canonical" href="https:\/\/packone\.pro\/terms\/#advertising-and-affiliates"/i);
assert.match(disclosureRedirect, /location\.replace\('\/terms\/#advertising-and-affiliates'\)/i);
const privacy = await readFile('privacy/index.html','utf8');
assert.match(privacy, /Google advertising is currently disabled, so Pack One does not currently load Google display ads/i);
assert.match(privacy, /TCGplayer links are routed through Impact/i);
assert.match(privacy, /records outbound TCGplayer clicks/i);
assert.doesNotMatch(privacy, /may earn a commission|Supporter or Elite membership|membership cannot be verified/i);

const noEmDashCopyFiles = [
  'index.html','ads.mjs','growth.mjs','draft-run-feedback.mjs','draft-run-product.mjs',
  'daily-home.mjs','practice-page.mjs','profile-product.mjs','home-today.mjs','share-cards.mjs',
  'how-it-works/index.html','learn/index.html','learn/first-pick-discipline/index.html',
  'learn/reading-consensus/index.html','learn/staying-open/index.html','scoring/index.html',
  'methodology/index.html','sets/index.html','sets/msh/index.html','sets/sos/index.html',
  'sets/tmt/index.html','sets/ecl/index.html','about/index.html','contact/index.html',
  'privacy/index.html','terms/index.html','disclosure/index.html','reset-password/index.html',
  'patreon-activation.mjs','site-nav.mjs','bootstrap.mjs',
  'admin/users.mjs','admin/admin.mjs','admin/corpus.mjs'
];
for (const path of noEmDashCopyFiles) {
  const source = await readFile(path,'utf8');
  assert.doesNotMatch(source,/—/, `${path} must not use em dashes in user-facing copy`);
}

const sitemap = await readFile('sitemap.xml','utf8');
assert.match(sitemap, /\/sets\/msh\//);
assert.match(sitemap, /\/learn\/first-pick-discipline\//);
assert.doesNotMatch(sitemap, /\/disclosure\//);
console.log('Editorial and monetization shell guardrails passed.');
