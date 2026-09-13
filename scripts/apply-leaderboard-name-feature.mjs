import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, text) {
  fs.writeFileSync(path, text);
}

function replaceOnce(path, before, after) {
  const text = read(path);
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`Missing patch target in ${path}: ${before.slice(0, 80)}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`Patch target is not unique in ${path}`);
  write(path, text.slice(0, first) + after + text.slice(first + before.length));
}

function replaceBetween(path, startMarker, endMarker, replacement) {
  const text = read(path);
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker in ${path}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing end marker in ${path}`);
  write(path, text.slice(0, start) + replacement + text.slice(end));
}

replaceBetween(
  'growth-api.mjs',
  'export async function updateProfile(',
  'export async function loadProfileHistory',
  [
    "export async function updateProfile({ displayName, profilePublic, favoriteSetId, showcaseAchievement } = {}) {",
    '  const body = {};',
    "  if (displayName !== undefined) body.displayName = String(displayName ?? '');",
    "  if (typeof profilePublic === 'boolean') body.profilePublic = profilePublic;",
    '  if (favoriteSetId !== undefined) body.favoriteSetId = favoriteSetId;',
    '  if (showcaseAchievement !== undefined) body.showcaseAchievement = showcaseAchievement;',
    "  const data = await api('/v1/profile', { method:'PATCH', body, auth:true });",
    '  if (data?.player?.display_name) {',
    '    try { localStorage.setItem(NAME_KEY, data.player.display_name); } catch {}',
    '  }',
    '  return data;',
    '}',
    '',
  ].join('\n'),
);

replaceBetween(
  'worker/growth-function.js',
  'async function handleProfileUpdate(request) {',
  'async function handleMyHistory(request) {',
  [
    'async function handleProfileUpdate(request) {',
    '  const id = await player(request);',
    '  const payload = await readJson(request);',
    '  const meta = await profileMetaByPlayer(id);',
    "  if (!meta) throw Object.assign(new Error('Player profile unavailable.'), { status: 404 });",
    '  if (!bool(meta.claimed)) {',
    "    throw Object.assign(new Error('Claim an account before publishing or customizing a profile.'), { status: 403 });",
    '  }',
    '',
    '  const current = await buildProfile(id, meta, { own: true });',
    '  const catalog = await loadCatalog();',
    "  const allowedSets = new Set((catalog.sets || []).map((entry) => String(entry?.id || '')).filter(Boolean));",
    '  const unlocked = new Set(current.achievements.filter((item) => item.unlocked).map((item) => item.id));',
    '',
    '  const displayName = payload.displayName === undefined ? meta.display_name : normalizeName(payload.displayName);',
    "  const profilePublic = typeof payload.profilePublic === 'boolean' ? payload.profilePublic : bool(meta.profile_public);",
    "  const favorite = payload.favoriteSetId === undefined ? meta.favorite_set_id || null : String(payload.favoriteSetId || '').trim().toLowerCase() || null;",
    "  const showcase = payload.showcaseAchievement === undefined ? meta.showcase_achievement || null : String(payload.showcaseAchievement || '').trim().toLowerCase() || null;",
    '',
    "  if (favorite && !allowedSets.has(favorite)) throw Object.assign(new Error('Choose a playable environment.'), { status: 400 });",
    "  if (showcase && !unlocked.has(showcase)) throw Object.assign(new Error('Showcase an achievement you have unlocked.'), { status: 400 });",
    '',
    '  await query(',
    '    `WITH previous AS MATERIALIZED (SELECT profile_public,display_name FROM players WHERE id=$1::uuid FOR UPDATE), changed AS (UPDATE players',
    '     SET display_name=$2,profile_public=$3::boolean,favorite_set_id=$4,showcase_achievement=$5,updated_at=now()',
    '     FROM previous WHERE id=$1::uuid RETURNING previous.profile_public was_public,previous.display_name old_display_name),',
    '     events(event_name) AS (',
    "       SELECT 'public_profile_enabled' FROM changed WHERE NOT was_public AND $3::boolean",
    '       UNION ALL',
    "       SELECT 'leaderboard_name_changed' FROM changed WHERE old_display_name IS DISTINCT FROM $2",
    '     )',
    '     INSERT INTO analytics_events(player_id,event_name) SELECT $1::uuid,event_name FROM events`,',
    '    [id, displayName, profilePublic, favorite, showcase],',
    '  );',
    '  const updatedMeta = await profileMetaByPlayer(id);',
    '  return json(await buildProfile(id, updatedMeta, { own: true }));',
    '}',
    '',
  ].join('\n'),
);

replaceBetween(
  'profile-product.mjs',
  'function settingsMarkup(profile, progress) {',
  'function profileMarkup(profile, catalog, { own = false, publicKey = null } = {}) {',
  [
    'function settingsMarkup(profile, progress) {',
    '  if (!profile.player.claimed) {',
    '    return `<aside class="profile-claim"><div><span>Guest record</span><strong>Your progress is yours to keep.</strong><p>Save it across devices whenever you’re ready.</p></div><button type="button" class="button secondary" id="profile-claim-account">Save my progress</button></aside>`;',
    '  }',
    '  const unlocked = unlockedAchievements(profile);',
    '  return `<details class="profile-settings">',
    '    <summary>Profile settings</summary>',
    '    <form id="profile-settings-form">',
    '      <label><span>Leaderboard name</span><input class="select" type="text" name="displayName" minlength="2" maxlength="24" autocomplete="nickname" value="${esc(profile.player.display_name)}" required><small>Shown on Draft Run and Cube leaderboards.</small></label>',
    '      <label class="profile-toggle"><input type="checkbox" name="profilePublic" ${profile.player.profile_public ? \'checked\' : \'\'}><span><strong>Public profile</strong><small>Allows leaderboard visitors and shared links to open your Pack One record.</small></span></label>',
    '      <label><span>Favorite environment</span><select class="select" name="favoriteSetId"><option value="">No favorite selected</option>${progress.environments.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === profile.player.favorite_set_id ? \'selected\' : \'\'}>${esc(entry.name)}</option>`).join(\'\')}</select></label>',
    '      <label><span>Showcase achievement</span><select class="select" name="showcaseAchievement"><option value="">No showcase selected</option>${unlocked.map((item) => `<option value="${esc(item.id)}" ${item.id === profile.player.showcase_achievement ? \'selected\' : \'\'}>${esc(item.label)}</option>`).join(\'\')}</select></label>',
    '      <div class="profile-settings-actions"><button class="button primary" type="submit">Save profile</button><span class="profile-settings-status" aria-live="polite"></span></div>',
    '    </form>',
    '  </details>`;',
    '}',
    '',
  ].join('\n'),
);

replaceOnce(
  'profile-product.mjs',
  '  const form = recentForm(profile);',
  '  const form = recentForm(profile);\n  const showLeaderboardName = own && Boolean(profile.player.claimed);',
);

replaceOnce(
  'profile-product.mjs',
  '    ${favorite || showcased || bestPct ? `<section class="profile-identity-strip">\n      ${favorite ? `<div><span>Favorite environment</span><strong>${esc(favorite.name)}</strong></div>` : \'\'}',
  '    ${showLeaderboardName || favorite || showcased || bestPct ? `<section class="profile-identity-strip">\n      ${showLeaderboardName ? `<div><span>Leaderboard name</span><strong>${esc(profile.player.display_name)}</strong></div>` : \'\'}\n      ${favorite ? `<div><span>Favorite environment</span><strong>${esc(favorite.name)}</strong></div>` : \'\'}',
);

replaceOnce(
  'profile-product.mjs',
  "      const updated = await updateProfile({\n        profilePublic: data.get('profilePublic') === 'on',",
  "      const updated = await updateProfile({\n        displayName: data.get('displayName') || '',\n        profilePublic: data.get('profilePublic') === 'on',",
);

replaceOnce(
  'profile.css',
  '.profile-settings .select { width:100%; }',
  '.profile-settings .select { width:100%; }\n.profile-settings label > small { display:block; margin-top:6px; color:var(--muted); font-size:10px; font-weight:500; line-height:1.4; }',
);

replaceOnce(
  'tests/profile-e2e.mjs',
  '        ...fixture.player,\n        profile_public:Boolean(updatePayload.profilePublic),',
  '        ...fixture.player,\n        display_name:updatePayload.displayName || fixture.player.display_name,\n        profile_public:Boolean(updatePayload.profilePublic),',
);

replaceOnce(
  'tests/profile-e2e.mjs',
  "  assert.equal(await page.locator('#profile-settings-form').count(), 1);\n  await noOverflow();",
  "  assert.equal(await page.locator('#profile-settings-form').count(), 1);\n  assert.match((await page.locator('.profile-identity-strip').textContent()) || '', /Leaderboard name\\s*Profile Tester/i);\n  await noOverflow();",
);

replaceOnce(
  'tests/profile-e2e.mjs',
  "  await page.locator('.profile-settings summary').click();\n  await page.locator('select[name=\"favoriteSetId\"]').selectOption('stx');",
  "  await page.locator('.profile-settings summary').click();\n  assert.equal(await page.locator('input[name=\"displayName\"]').inputValue(), 'Profile Tester');\n  await page.locator('input[name=\"displayName\"]').fill('Leaderboard Ace');\n  await page.locator('select[name=\"favoriteSetId\"]').selectOption('stx');",
);

replaceOnce(
  'tests/profile-e2e.mjs',
  "  assert.deepEqual(updatePayload, { profilePublic:true, favoriteSetId:'stx', showcaseAchievement:'top10' });",
  "  assert.deepEqual(updatePayload, { displayName:'Leaderboard Ace', profilePublic:true, favoriteSetId:'stx', showcaseAchievement:'top10' });\n  assert.equal((await page.locator('.profile-hero h1').textContent())?.trim(), 'Leaderboard Ace');\n  assert.equal(await page.evaluate(() => localStorage.getItem('pack1-player-name-v1')), 'Leaderboard Ace');",
);

replaceOnce(
  'tests/profile-platform.test.mjs',
  "  assert.match(api, /lookupPublicProfiles/);\n});",
  "  assert.match(api, /lookupPublicProfiles/);\n  assert.match(api, /displayName/);\n  assert.match(worker, /leaderboard_name_changed/);\n  assert.match(product, /Leaderboard name/);\n});",
);

replaceOnce(
  'tests/draft-run-backend-smoke.mjs',
  "assert.equal(history.player.profile_key,(await call(growth,'/v1/profile/me',undefined,owner.token)).player.profile_key);\nawait call(growth,'/v1/profile',{profilePublic:true},owner.token,200,{method:'PATCH'});",
  "assert.equal(history.player.profile_key,(await call(growth,'/v1/profile/me',undefined,owner.token)).player.profile_key);\nconst leaderboardName='AA Drafter '+tag;\nlet renamed=await call(growth,'/v1/profile',{displayName:leaderboardName},owner.token,200,{method:'PATCH'});\nassert.equal(renamed.player.display_name,leaderboardName);\nrenamed=await call(growth,'/v1/profile',{displayName:leaderboardName},owner.token,200,{method:'PATCH'});\nassert.equal(renamed.player.display_name,leaderboardName);\nawait query(\"INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json) VALUES($1::uuid,$2::date,'mixed','draft_run',100,'A','[]'::jsonb) ON CONFLICT DO NOTHING\",[owner.playerId,gameDateKey()]);\nconst namedBoard=await call(runApi,'/v1/leaderboard?period=daily&environment=mixed');\nassert.equal(namedBoard.rows.find(row=>row.display_name===leaderboardName)?.display_name,leaderboardName);\nawait call(growth,'/v1/profile',{profilePublic:true},owner.token,200,{method:'PATCH'});",
);

replaceOnce(
  'tests/draft-run-backend-smoke.mjs',
  "const analytics=(await query(\"SELECT event_name,count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name IN('account_claimed','public_profile_enabled') GROUP BY event_name\",[owner.playerId])).rows;\nassert.ok(analytics.every(r=>Number(r.n)===1));assert.equal(analytics.length,2);",
  "const analytics=(await query(\"SELECT event_name,count(*) n FROM analytics_events WHERE player_id=$1::uuid AND event_name IN('account_claimed','public_profile_enabled','leaderboard_name_changed') GROUP BY event_name\",[owner.playerId])).rows;\nassert.ok(analytics.every(r=>Number(r.n)===1));assert.equal(analytics.length,3);",
);

console.log('Applied editable leaderboard-name feature.');
