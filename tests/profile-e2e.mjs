import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.PACK1_E2E_URL || 'http://127.0.0.1:4173';
const growthOrigin = 'https://br-orange-feather-ayps8kep-pack1growth.compute.c-5.us-east-2.aws.neon.tech';
const profileKey = '0123456789abcdef';
await mkdir('artifacts', { recursive: true });

const browser = await chromium.launch(process.env.CI ? { headless:true, channel:'chrome' } : { headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 } });
let updatePayload = null;
let shareCalls = 0;

await page.addInitScript(() => {
  Object.defineProperty(navigator, 'share', { configurable:true, value: async () => { window.__pack1ShareCalls = (window.__pack1ShareCalls || 0) + 1; } });
  Object.defineProperty(navigator, 'canShare', { configurable:true, value: () => false });
});

const fixture = {
  player: {
    display_name:'Profile Tester',
    profile_key:profileKey,
    profile_public:true,
    favorite_set_id:'neo',
    showcase_achievement:'explorer5',
    claimed:true,
  },
  summary: {
    games:42,
    average_score:78.6,
    best_score:100,
    challenge_wins:8,
    challenge_losses:3,
    challenge_ties:1,
    daily_games:14,
    environments_played:6,
    current_streak:5,
  },
  environment_total:33,
  by_set:[
    { set_id:'neo', games:8, average_score:86.2, best_score:100, daily_games:3, last_played_at:'2026-09-09T12:00:00Z' },
    { set_id:'stx', games:6, average_score:82.1, best_score:95, daily_games:2, last_played_at:'2026-09-08T12:00:00Z' },
    { set_id:'mid', games:5, average_score:79.4, best_score:91, daily_games:2, last_played_at:'2026-09-07T12:00:00Z' },
    { set_id:'vow', games:4, average_score:77.0, best_score:88, daily_games:1, last_played_at:'2026-09-06T12:00:00Z' },
    { set_id:'msh', games:3, average_score:75.0, best_score:84, daily_games:1, last_played_at:'2026-09-05T12:00:00Z' },
    { set_id:'powered-cube', games:2, average_score:73.5, best_score:81, daily_games:0, last_played_at:'2026-09-04T12:00:00Z' },
  ],
  by_mode:[
    { mode:'top3', games:24, average_score:81.2, best_score:100 },
    { mode:'full', games:18, average_score:75.1, best_score:94 },
  ],
  best_environments:[
    { set_id:'neo', games:8, average_score:86.2, best_score:100 },
    { set_id:'stx', games:6, average_score:82.1, best_score:95 },
    { set_id:'mid', games:5, average_score:79.4, best_score:91 },
  ],
  cube:{ set_id:'powered-cube', games:2, average_score:73.5, best_score:81 },
  daily_history:[
    { date:'2026-09-09', set_id:'neo', mode:'top3', score:93, grade:'A', rank:7, total:100, percentile:7 },
    { date:'2026-09-08', set_id:'stx', mode:'full', score:84, grade:'B+', rank:18, total:90, percentile:20 },
  ],
  recent:Array.from({ length:20 }, (_,index) => ({
    cursor:String(200-index),
    played_at:`2026-09-${String(Math.max(1,9-Math.floor(index/3))).padStart(2,'0')}T12:00:00Z`,
    set_id:index % 5 === 0 ? 'powered-cube' : index % 2 ? 'neo' : 'stx',
    mode:index % 3 ? 'top3' : 'full',
    score:70 + (index % 25),
    grade:'B',
    is_daily:index < 4,
    outcome:null,
  })),
  trend:Array.from({ length:12 }, (_,index) => ({ played_at:`2026-09-${String(index+1).padStart(2,'0')}T12:00:00Z`, score:70+index, set_id:'neo', mode:'top3' })),
  achievements:[
    { id:'first', label:'First Pack', description:'Complete your first scored Pack One game.', unlocked:true, current:1, target:1, progress_text:'1/1' },
    { id:'explorer5', label:'Archive Explorer', description:'Play five different environments.', unlocked:true, current:5, target:5, progress_text:'5/5' },
    { id:'explorer10', label:'Format Traveler', description:'Play ten different environments.', unlocked:false, current:6, target:10, progress_text:'6/10' },
    { id:'top10', label:'Top Ten Percent', description:'Finish in the top 10% of a Daily leaderboard with at least 10 players.', unlocked:true, current:1, target:1, progress_text:'Top 7% best' },
  ],
};

await page.route(`${growthOrigin}/**`, async (route) => {
  const url = new URL(route.request().url());
  let status = 200;
  let body = { ok:true };
  if (url.pathname === '/v1/session') {
    body = { token:'p1_00000000-0000-4000-8000-000000000000.e2e', playerId:'00000000-0000-4000-8000-000000000000', displayName:'Profile Tester', profileKey };
  } else if (url.pathname === '/v1/account/session') {
    status = 401;
    body = { error:'Account session required.' };
  } else if (url.pathname === '/v1/profile/me') {
    body = fixture;
  } else if (url.pathname === `/v1/profile/${profileKey}`) {
    body = { ...fixture, player:{ ...fixture.player, claimed:undefined } };
  } else if (url.pathname === '/v1/profile/history' || url.pathname === `/v1/profile/${profileKey}/history`) {
    body = { rows:[{ cursor:'150', played_at:'2026-08-30T12:00:00Z', set_id:'woe', mode:'top3', score:88, grade:'A-', is_daily:false, outcome:null }], next_cursor:null };
  } else if (url.pathname === '/v1/profile' && route.request().method() === 'PATCH') {
    updatePayload = route.request().postDataJSON();
    body = {
      ...fixture,
      player:{
        ...fixture.player,
        profile_public:Boolean(updatePayload.profilePublic),
        favorite_set_id:updatePayload.favoriteSetId || null,
        showcase_achievement:updatePayload.showcaseAchievement || null,
      },
    };
  } else if (url.pathname === '/v1/profile-lookup') {
    body = { profiles:{ 'profile tester':{ display_name:'Profile Tester', profile_key:profileKey } } };
  } else if (url.pathname === '/v1/stats') {
    body = { summary:fixture.summary, bySet:fixture.by_set, byMode:fixture.by_mode, recent:fixture.recent };
  } else if (url.pathname === '/v1/account/daily-dates') {
    body = { dates:['2026-09-09','2026-09-08'] };
  } else if (url.pathname === '/v1/events') {
    body = { ok:true, accepted:1 };
  }
  await route.fulfill({ status, contentType:'application/json', body:JSON.stringify(body) });
});

async function noOverflow() {
  const metrics = await page.evaluate(() => ({ client:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth }));
  assert.ok(metrics.scroll <= metrics.client + 1, `profile horizontal overflow: ${metrics.scroll} > ${metrics.client}`);
}

try {
  await page.goto(base, { waitUntil:'domcontentloaded' });
  await page.locator('#profile-nav').waitFor({ timeout:10000 });
  await page.locator('#profile-nav').click();
  await page.locator('.player-profile-page').waitFor({ timeout:10000 });
  assert.equal((await page.locator('.profile-hero h1').textContent())?.trim(), 'Profile Tester');

  const catalogTotal = await page.evaluate(async () => {
    const response = await fetch('/data/catalog.json', { cache:'no-store' });
    const data = await response.json();
    return (data.sets || []).filter((entry) => entry?.id && !entry.is_fixture).length;
  });
  assert.equal(await page.locator('.environment-progress-card').count(), catalogTotal, 'profile archive must follow the production catalog dynamically');
  assert.match((await page.locator('.archive-progress-section h2').textContent()) || '', new RegExp(`6/${catalogTotal} environments played`));
  assert.equal(await page.locator('[data-environment-id="powered-cube"].played').count(), 1, 'Powered Cube must be part of archive progression');
  assert.match((await page.locator('.cube-profile-callout').textContent()) || '', /73\.5 avg/i);
  assert.match((await page.locator('.profile-daily-list li').first().textContent()) || '', /Top 7%/i);
  assert.equal(await page.locator('.achievement-card').count(), fixture.achievements.length);
  assert.equal(await page.locator('.achievement-card.locked').count(), 1);
  assert.equal(await page.locator('.achievement-card.showcase').count(), 1);
  assert.equal(await page.locator('[data-profile-section="archive"]').getAttribute('open'), null, 'large archive starts collapsed');
  await page.locator('[data-profile-section="archive"] summary').click();
  assert.ok(await page.locator('[data-environment-id="neo"] a').isVisible(), 'archive entries are directly playable');
  await page.locator('[data-profile-section="archive"] summary').click();
  await page.locator('[data-profile-section="achievements"] summary').click();
  assert.equal(await page.locator('.achievement-card.unlocked').first().isVisible(), true);
  assert.equal(await page.locator('#profile-settings-form').count(), 1);
  await noOverflow();
  await page.screenshot({ path:'artifacts/ui-profile-mobile.png', fullPage:true });

  await page.locator('#profile-load-more').click();
  await page.getByText('WOE', { exact:true }).last().waitFor({ timeout:5000 });
  await page.locator('#profile-load-more').waitFor({ state:'hidden', timeout:5000 });

  await page.locator('.profile-settings summary').click();
  await page.locator('select[name="favoriteSetId"]').selectOption('stx');
  await page.locator('select[name="showcaseAchievement"]').selectOption('top10');
  await page.locator('#profile-settings-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('.player-profile-page') && document.querySelector('select[name="favoriteSetId"]')?.value === 'stx');
  assert.deepEqual(updatePayload, { profilePublic:true, favoriteSetId:'stx', showcaseAchievement:'top10' });

  await page.locator('#profile-share-progress').click();
  await page.waitForFunction(() => (window.__pack1ShareCalls || 0) > 0, null, { timeout:5000 });
  shareCalls = await page.evaluate(() => window.__pack1ShareCalls || 0);
  assert.equal(shareCalls, 1, 'archive progress share should invoke native share');

  await page.goto(`${base}/?profile=${profileKey}`, { waitUntil:'domcontentloaded' });
  await page.locator('.player-profile-page').waitFor({ timeout:10000 });
  assert.equal(await page.locator('#profile-settings-form').count(), 0, 'public visitor must not see owner settings');
  assert.equal(await page.locator('#profile-share').isEnabled(), true);
  assert.match((await page.locator('.profile-hero').textContent()) || '', /public Pack One career/i);
  await noOverflow();
  await page.screenshot({ path:'artifacts/ui-profile-public-mobile.png', fullPage:true });

  console.log('Player profile / progression browser regression passed.');
} finally {
  await browser.close();
}
