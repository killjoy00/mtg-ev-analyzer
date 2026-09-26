const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function compileStorage(store) {
  const filename = path.join(process.cwd(), 'src', 'storage', 'sharedRun.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const priorLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'expo-secure-store') return store;
    return priorLoad.call(this, request, parent, isMain);
  };
  try {
    compiled._compile(output, filename);
  } finally {
    Module._load = priorLoad;
  }
  return compiled.exports;
}

function session(playerId, accountId) {
  return {
    playerToken: 'p1_' + playerId + '.' + 'A'.repeat(43),
    subjectId: playerId,
    accountToken: 'B'.repeat(43),
    accountUser: { id: accountId, email: 'player@example.com' },
  };
}

test('shared-run continuation is readable only by the exact signed-in player and account', async () => {
  let raw = null;
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    async getItemAsync() { return raw; },
    async setItemAsync(_key, value, options) {
      assert.equal(options.keychainAccessible, 'device-only');
      raw = value;
    },
    async deleteItemAsync() { raw = null; },
  };
  const storage = compileStorage(store);
  const share = 'a'.repeat(24);
  const run = '11111111-1111-4111-8111-111111111111';
  const playerA = '22222222-2222-4222-8222-222222222222';
  const playerB = '33333333-3333-4333-8333-333333333333';
  const accountA = '44444444-4444-4444-8444-444444444444';
  const accountB = '55555555-5555-4555-8555-555555555555';

  await storage.writeSharedRunContinuation(share, run, session(playerA, accountA));
  assert.equal(await storage.readSharedRunContinuation(share, session(playerA, accountA)), run);
  assert.equal(await storage.readSharedRunContinuation(share, session(playerB, accountA)), null);
  assert.equal(await storage.readSharedRunContinuation(share, session(playerA, accountB)), null);
  assert.equal(await storage.readSharedRunContinuation('b'.repeat(24), session(playerA, accountA)), null);
});

test('shared-run continuation refuses guest sessions and malformed identifiers', async () => {
  let raw = null;
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
    async getItemAsync() { return raw; },
    async setItemAsync(_key, value) { raw = value; },
    async deleteItemAsync() { raw = null; },
  };
  const storage = compileStorage(store);
  const signed = session(
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
  );
  const guest = { playerToken: signed.playerToken };
  await assert.rejects(
    () => storage.writeSharedRunContinuation('a'.repeat(24), '11111111-1111-4111-8111-111111111111', guest),
    /Sign in/,
  );
  await assert.rejects(
    () => storage.writeSharedRunContinuation('bad', '11111111-1111-4111-8111-111111111111', signed),
    /Invalid shared-run continuation/,
  );
  assert.equal(await storage.readSharedRunContinuation('bad', signed), null);
});
