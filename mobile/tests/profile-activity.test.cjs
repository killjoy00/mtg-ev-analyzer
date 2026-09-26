const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function compile(relative, mocks = {}, cache = new Map()) {
  const filename = path.join(process.cwd(), relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = new Module(filename, module);
  cache.set(filename, compiled);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled.require = (name) => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return compile(`${name.slice(2)}.ts`, mocks, cache);
    return require(name);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
  }).outputText, filename);
  return compiled.exports;
}
const model = compile('src/state/profileActivity.ts');
const { createProfileActivityController } = compile('src/state/profileActivityController.ts');
const PLAYER = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const KEY = 'a'.repeat(16);
const session = (id = ACCOUNT) => ({ playerToken: `p1_${PLAYER}.${'A'.repeat(43)}`, subjectId: PLAYER,
  accountToken: (id === ACCOUNT ? 'B' : 'C').repeat(43), accountUser: { id } });
const daily = (extra = {}) => ({ date: '2026-09-25', set_id: 'mixed', mode: 'draft_run', score: 0,
  rank: 2, total: 10, percentile: 20, final: true, ...extra });
const profile = (name = 'Player A', extra = {}) => ({
  player: { display_name: name, profile_key: KEY, profile_public: false, favorite_set_id: 'msh' },
  by_set: [{ set_id: 'msh', games: 3, average_score: 81.2, best_score: 99 }],
  achievements: [{ id: 'first', label: 'First Pack', unlocked: true }, { id: 'locked', label: 'Not yet', unlocked: false }],
  daily_history: [daily()], ...extra,
});
const target = { kind: 'daily', date: '2026-09-25', set: 'mixed', mode: 'draft_run' };
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(scope = { kind: 'private' }, overrides = {}) {
  let stored = session();
  let record = profile();
  let state;
  const calls = [];
  const io = {
    readSession: async () => stored,
    loadPrivate: async (owner) => { calls.push(['private', owner.accountUser.id]); return record; },
    loadPublic: async (key) => { calls.push(['public', key]); return { ...record, player: { ...record.player, profile_key: key, profile_public: true } }; },
    loadArchive: async () => [{ id: 'msh', name: 'Marvel', dataDate: null }, { id: 'vow', name: 'Crimson Vow', dataDate: null }],
    loadCoverage: async () => ({ corpus_version: 'fixture', sets: [] }),
    share: async (text) => { calls.push(['share', text]); return { action: 'sharedAction' }; },
    changed: (value) => { state = value; },
    ...overrides,
  };
  const controller = createProfileActivityController(scope, io);
  controller.resume();
  await drain();
  return { controller, calls, io, state: () => state, setSession: (value) => { stored = value; }, setProfile: (value) => { record = value; } };
}

test('route scope rejects malformed public keys rather than falling back to private', () => {
  assert.deepEqual(model.activityScope(undefined), { kind: 'private' });
  assert.deepEqual(model.activityScope(KEY), { kind: 'public', key: KEY });
  for (const key of ['', null, [], [KEY], 'b'.repeat(24), 'https://example.invalid']) assert.throws(() => model.activityScope(key));
});
test('archive uses the published catalog, excludes fixtures, and does not count out-of-catalog results', () => {
  const entries = model.checkedArchive({ sets: [{ id: 'msh', name: 'Marvel' }, { id: 'vow', name: 'Crimson Vow' }, { id: 'qa', is_fixture: true }] });
  const record = profile();
  record.by_set.push({ set_id: 'other', games: 100, average_score: 90, best_score: 100 });
  const rows = model.archiveProgress(entries, record);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((entry) => entry.played).length, 1);
  assert.equal(rows[0].favorite, true);
  assert.deepEqual(model.filterArchive(rows, 'unplayed', 'VOW').map((row) => row.id), ['vow']);
  assert.equal(model.filterArchive(rows, 'played', 'crimson').length, 0);
  assert.equal(model.filterArchive(rows, 'all', 'unknown').length, 0);
});
test('invalid and duplicate catalog identifiers fail closed', () => {
  for (const sets of [[{ id: '../secret' }], [{ id: 'msh' }, { id: 'msh' }], [{ id: 'msh', name: {} }]]) assert.throws(() => model.checkedArchive({ sets }));
  assert.throws(() => model.checkedArchive({}));
});
test('daily copy preserves zero, date, Live versus Final, mode, and privacy', () => {
  const record = profile();
  const text = model.activityShareMessage(record, target);
  assert.match(text, /0\/100/);
  assert.match(text, /Daily 2026-09-25/);
  assert.match(text, /Final/);
  assert.doesNotMatch(text, /profile=|today|shared=|challenge=|daily=1/);
  record.daily_history[0].final = false;
  assert.match(model.activityShareMessage(record, target), /Live, so far/);
  delete record.daily_history[0].final;
  assert.match(model.activityShareMessage(record, target), /not marked final/);
});
test('achievement sharing requires a unique currently-unlocked server record', () => {
  assert.throws(() => model.activityShareMessage(profile(), { kind: 'achievement', id: 'locked' }));
  const record = profile(); record.player.profile_public = true;
  assert.match(model.activityShareMessage(record, { kind: 'achievement', id: 'first' }), new RegExp(`profile=${KEY}`));
  record.achievements.push({ ...record.achievements[0] });
  assert.throws(() => model.activityShareMessage(record, { kind: 'achievement', id: 'first' }));
});
test('daily lookup uses date, environment and mode, never an array position', () => {
  const record = profile(); record.daily_history.unshift(daily({ mode: 'full', score: 96 }));
  assert.match(model.activityShareMessage(record, target), /0\/100/);
  assert.throws(() => model.activityShareMessage(record, { ...target, set: 'latest' }));
  record.daily_history.push(daily());
  assert.throws(() => model.activityShareMessage(record, target));
});
test('invalid dates, non-numeric scores and a private public response cannot be activity records', () => {
  for (const row of [daily({ date: '2026-02-30' }), daily({ score: NaN }), daily({ set_id: undefined })]) {
    assert.throws(() => model.checkedActivityProfile(profile('A', { daily_history: [row] }), { kind: 'private' }));
  }
  assert.throws(() => model.checkedActivityProfile(profile(), { kind: 'public', key: KEY }));
});
test('guest and mismatched native player/account sessions do not produce an owner key', () => {
  assert.equal(model.activitySessionKey(null), null);
  assert.equal(model.activitySessionKey({ playerToken: session().playerToken }), null);
  assert.equal(model.activitySessionKey({ ...session(), subjectId: OTHER }), null);
  assert.notEqual(model.activitySessionKey(session()), model.activitySessionKey(session(OTHER)));
});
test('progress presentation never grants an achievement', () => {
  assert.equal(model.achievementProgress({ current: 30, target: 10, unlocked: false }), 100);
  assert.equal(model.achievementProgress({ current: 1, target: 0 }), null);
});
test('private sharing re-reads current facts instead of exporting the mounted snapshot', async () => {
  const h = await fixture();
  h.setProfile(profile('Updated name', { daily_history: [daily({ score: 88, final: false })] }));
  await h.controller.share(target);
  const text = h.calls.find(([kind]) => kind === 'share')[1];
  assert.match(text, /Updated name scored 88/); assert.match(text, /Live, so far/);
  assert.equal(h.calls.filter(([kind]) => kind === 'private').length, 2);
});
test('an achievement that is no longer unlocked cannot be shared from a stale button', async () => {
  const h = await fixture();
  h.setProfile(profile('A', { achievements: [] }));
  await h.controller.share({ kind: 'achievement', id: 'first' });
  assert.equal(h.calls.filter(([kind]) => kind === 'share').length, 0);
  assert.match(h.state().shareError, /not currently available/);
});
test('a silent account switch before sharing removes A without reading or sharing A', async () => {
  const h = await fixture(); h.setSession(session(OTHER));
  await h.controller.share(target);
  assert.equal(h.state().profile, null);
  assert.equal(h.calls.filter(([kind]) => kind === 'private').length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'share').length, 0);
});
test('sign-out during share preflight cannot open the share sheet', async () => {
  const h = await fixture(); const pending = deferred();
  h.io.loadPrivate = async () => pending.promise;
  const sharing = h.controller.share(target); await drain();
  h.setSession(null); pending.resolve(profile()); await sharing;
  assert.equal(h.state().phase, 'guest'); assert.equal(h.state().profile, null);
  assert.equal(h.calls.filter(([kind]) => kind === 'share').length, 0);
});
test('locked storage after a server read removes private content', async () => {
  const h = await fixture();
  h.io.loadPrivate = async () => { h.io.readSession = async () => { throw new Error('locked'); }; return profile(); };
  await h.controller.share(target);
  assert.equal(h.state().profile, null); assert.match(h.state().error, /Unlock/);
});
test('an identity notification clears A immediately, and a late A failure cannot clear B', async () => {
  const h = await fixture(); const a = deferred();
  h.io.loadPrivate = async (owner) => owner.accountUser.id === ACCOUNT ? a.promise : profile('Player B');
  const old = h.controller.refresh(); await drain();
  h.setSession(session(OTHER)); h.controller.sessionChanged(session(OTHER));
  assert.equal(h.state().profile, null); await drain();
  assert.equal(h.state().profile.player.display_name, 'Player B');
  a.reject(Object.assign(new Error('old unauthorized'), { status: 401 })); await old;
  assert.equal(h.state().profile.player.display_name, 'Player B');
});
test('same-account transient refresh failure keeps the loaded record with an error', async () => {
  const h = await fixture(); h.io.loadPrivate = async () => { throw new Error('offline'); };
  await h.controller.refresh(); assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().profile.player.display_name, 'Player A'); assert.match(h.state().error, /offline/);
});
for (const status of [401, 403, 404, 410]) test(`public visibility denial ${status} removes cached record and share text`, async () => {
  const h = await fixture({ kind: 'public', key: KEY });
  h.io.loadPublic = async () => { throw Object.assign(new Error('private'), { status }); };
  await h.controller.share(target);
  assert.equal(h.state().profile, null); assert.equal(h.state().shareText, null);
  assert.equal(h.calls.filter(([kind]) => kind === 'share').length, 0);
});
test('public activity never reads private session or uses private profile transport', async () => {
  const fail = () => { throw new Error('private IO forbidden'); };
  const h = await fixture({ kind: 'public', key: KEY }, { readSession: fail, loadPrivate: fail });
  await h.controller.share(target); assert.equal(h.state().phase, 'ready');
  assert.match(h.calls.find(([kind]) => kind === 'share')[1], new RegExp(`profile=${KEY}`));
});
test('a malformed refreshed profile clears the previously loaded record', async () => {
  const h = await fixture(); h.io.loadPrivate = async () => ({ player: {} });
  await h.controller.refresh(); assert.equal(h.state().profile, null); assert.equal(h.state().phase, 'error');
});
test('leaving a scope during delayed public preflight prevents sharing', async () => {
  const h = await fixture({ kind: 'public', key: KEY }); const pending = deferred();
  h.io.loadPublic = async () => pending.promise;
  const task = h.controller.share(target); await drain(); h.controller.pause();
  pending.resolve(profile('A', { player: { display_name: 'A', profile_public: true, profile_key: KEY } })); await task;
  assert.equal(h.calls.filter(([kind]) => kind === 'share').length, 0);
});
test('duplicate taps and foreground refresh cannot overlap a pending native share', async () => {
  const h = await fixture(); const sheet = deferred(); let calls = 0;
  h.io.share = async () => { calls += 1; return sheet.promise; };
  const first = h.controller.share(target); const second = h.controller.share(target); await drain();
  await h.controller.refresh(); assert.equal(calls, 1);
  sheet.resolve({ action: 'dismissedAction' }); await Promise.all([first, second]);
  assert.equal(h.state().shareError, null); assert.equal(h.state().sharing, false);
});
test('native share failure retains verified selectable text but does not claim completion', async () => {
  const h = await fixture(); h.io.share = async () => { throw new Error('sheet unavailable'); };
  await h.controller.share(target); assert.match(h.state().shareText, /Player A scored/);
  assert.match(h.state().shareError, /sheet unavailable/);
});
test('archive progress survives live coverage failure; missing archive is not empty completion', async () => {
  const h = await fixture(); h.io.loadCoverage = async () => { throw new Error('live unavailable'); };
  await h.controller.catalog(); assert.equal(h.state().archive.length, 2);
  assert.match(h.state().coverageError, /live unavailable/);
  h.io.loadArchive = async () => { throw new Error('catalog unavailable'); };
  await h.controller.catalog(); assert.equal(h.state().archive, null);
  assert.equal(h.state().profile.player.display_name, 'Player A');
});
test('catalog requests are deduplicated and cannot resurrect private data after sign-out', async () => {
  const h = await fixture(); const pending = deferred(); let reads = 0;
  h.io.loadArchive = () => { reads += 1; return pending.promise; };
  const first = h.controller.catalog(); const second = h.controller.catalog(); await drain();
  h.setSession(null); h.controller.sessionChanged(null);
  pending.resolve([]); await Promise.all([first, second]);
  assert.equal(reads, 1); assert.equal(h.state().phase, 'guest'); assert.equal(h.state().profile, null);
});

test('archive adapter uses fixed public destinations and never accepts manifest or identity inputs', async () => {
  const calls = []; const old = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push([url, options]); return { ok: true, text: async () => JSON.stringify({ sets: [{ id: 'msh', manifest_path: 'https://evil.invalid' }] }) }; };
  const api = compile('src/api/profileArchive.ts', { '@/src/api/client': { requestJson: async (...args) => { calls.push(args); return { corpus_version: 'fixture', sets: [] }; } } });
  try {
    assert.equal((await api.loadProfileArchive())[0].id, 'msh'); await api.loadProfileCoverage();
    assert.equal(calls[0][0], 'https://packone.pro/data/catalog.json'); assert.equal(calls[0][1].credentials, 'omit');
    assert.equal(calls[1][0], '/draft/v1/set-catalog'); assert.equal(calls[1][1].credentials, 'omit');
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = old; }
});
