const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const KEY = 'a'.repeat(16);
const base = () => ({ player: { display_name: 'Public Player', profile_key: KEY, profile_public: true },
  summary: { games: 1, average_score: 80, best_score: 80 }, by_set: [], by_mode: [], best_environments: [], daily_history: [], recent: [], trend: [], achievements: [] });
const row = () => ({ cursor: '90', played_at: '2026-09-26T00:00:00Z', set_id: 'msh', mode: 'draft_run', score: 80, is_daily: false });

function api(t, fetcher) {
  const priorFetch = globalThis.fetch; const cache = new Map(); const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return fetcher(url, init); };
  t.after(() => { globalThis.fetch = priorFetch; });
  function compile(relative) {
    const filename = path.join(process.cwd(), relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename)); cache.set(filename, mod);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const prior = Module._load;
    Module._load = function load(request, parent, main) {
      if (request === '@/src/config') return { config: { api: { origin: 'https://api.packone.pro' } } };
      if (request === '@/src/api/client') return compile('src/api/client.ts');
      return prior.call(this, request, parent, main);
    };
    try { mod._compile(output, filename); } finally { Module._load = prior; }
    return mod.exports;
  }
  return { ...compile('src/api/publicProfile.ts'), ...compile('src/api/client.ts'), calls };
}

test('public profile transport uses exact public routes, no identity headers and credentials omitted', async (t) => {
  const a = api(t, (url) => Response.json(url.includes('/history') ? { rows: [row()], next_cursor: null } : base()));
  await a.loadPublicProfile(KEY); await a.loadPublicProfileHistory(KEY, '100');
  assert.equal(a.calls[0].url, `https://api.packone.pro/growth/v1/profile/${KEY}`);
  assert.equal(a.calls[1].url, `https://api.packone.pro/growth/v1/profile/${KEY}/history?limit=25&cursor=100`);
  for (const { init } of a.calls) {
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
    assert.deepEqual([...init.headers.keys()], ['accept']); assert.equal(init.body, undefined);
  }
});

test('invalid keys and cursor injection are rejected before network access', async (t) => {
  const a = api(t, () => { throw new Error('must not request'); });
  for (const key of ['', 'A'.repeat(16), 'b'.repeat(15), ['a'.repeat(16)], '../account', KEY + '?token=secret']) {
    await assert.rejects(a.loadPublicProfile(key), a.InvalidPublicProfileError);
    await assert.rejects(a.loadPublicProfileHistory(key), a.InvalidPublicProfileError);
  }
  for (const cursor of ['x', '1&account=1', '9'.repeat(31)]) await assert.rejects(a.loadPublicProfileHistory(KEY, cursor), a.InvalidPublicProfileError);
  assert.equal(a.calls.length, 0);
});

test('private, mismatched and malformed profile payloads are not accepted as public records', async (t) => {
  let value; const a = api(t, () => Response.json(value));
  for (value of [null, {}, { ...base(), player: { ...base().player, profile_public: false } },
    { ...base(), player: { ...base().player, profile_key: 'b'.repeat(16) } }, { ...base(), achievements: null }]) {
    await assert.rejects(a.loadPublicProfile(KEY), a.InvalidPublicProfileError);
  }
});

test('malformed history rows and cursors fail validation', async (t) => {
  let value; const a = api(t, () => Response.json(value));
  for (value of [{ rows: [row()], next_cursor: 'javascript:x' }, { rows: [null], next_cursor: null },
    { rows: [{ ...row(), cursor: 'x' }], next_cursor: null }, { rows: [row()], next_cursor: 90 },
    { rows: [{ ...row(), score: '80' }], next_cursor: null }, { rows: [], next_cursor: undefined }]) {
    await assert.rejects(a.loadPublicProfileHistory(KEY), a.InvalidPublicProfileError);
  }
});

test('server privacy errors retain their status for screen-level cache invalidation', async (t) => {
  const a = api(t, () => Response.json({ error: 'Profile not found or private.' }, { status: 404 }));
  await assert.rejects(a.loadPublicProfile(KEY), (error) => error instanceof a.ApiError && error.status === 404);
  await assert.rejects(a.loadPublicProfileHistory(KEY), (error) => error instanceof a.ApiError && error.status === 404);
});

test('canonical public sharing accepts only public key material', (t) => {
  const a = api(t, () => { throw new Error('no network'); });
  assert.equal(a.publicProfileUrl(KEY), `https://packone.pro/?profile=${KEY}`);
  assert.throws(() => a.publicProfileUrl(KEY + '&accountToken=secret'), a.InvalidPublicProfileError);
});

test('the shared client preserves existing authenticated request behavior unless omit is explicitly selected', async (t) => {
  const a = api(t, () => Response.json({ ok: true }));
  await a.requestJson('/growth/v1/mobile/profile/me', { mobileSessionToken: 'player', mobileAccountToken: 'account' });
  assert.equal(a.calls[0].init.credentials, undefined);
  assert.equal(a.calls[0].init.headers.get('x-pack1-mobile-session'), 'player');
  assert.equal(a.calls[0].init.headers.get('x-pack1-mobile-account'), 'account');
});
