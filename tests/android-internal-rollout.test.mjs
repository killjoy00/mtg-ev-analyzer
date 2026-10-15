import test from 'node:test';
import assert from 'node:assert/strict';
import { rolloutInternalRelease } from '../mobile/scripts/play-internal-rollout.mjs';

function playFixture({
  internalVersion = '100846',
  internalStatus = 'draft',
  closedVersion = '100772',
  closedStatus = 'completed',
  includePriorInternal = true,
  priorInternalVersion = '100810',
  priorInternalStatus = 'completed',
  duplicateInternal = false,
  rejectValidation = false,
  mutateOtherOnStagedRead = false,
} = {}) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initial = {
    tracks: [
      { track: 'internal', releases: [
        { name: 'Pack One internal 3bf4e91', status: internalStatus, versionCodes: [internalVersion] },
        ...(includePriorInternal ? [{ name: 'Pack One internal 9f0b499', status: priorInternalStatus, versionCodes: [priorInternalVersion] }] : []),
        ...(duplicateInternal ? [{ name: 'Unexpected old release', status: 'completed', versionCodes: ['100016'] }] : []),
      ] },
      { track: 'production-access', releases: [
        { name: 'Pack One closed 100772', status: closedStatus, versionCodes: [closedVersion] },
      ] },
      { track: 'production', releases: [] },
    ],
  };
  const state = { live: clone(initial), calls: [], edits: new Map(), count: 0, stagedReadDone: false };
  const response = (status, data) => ({
    status, ok: status >= 200 && status < 300,
    async text() { return data === null ? '' : JSON.stringify(data); },
  });

  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    const path = new URL(url).pathname.split('/applications/pro.packone.app')[1];
    state.calls.push({ method, path, body: options.body && JSON.parse(options.body) });

    if (method === 'POST' && path === '/edits') {
      const id = 'e' + ++state.count;
      state.edits.set(id, clone(state.live));
      return response(200, { id });
    }
    const found = /^\/edits\/(e[0-9]+)(.*)$/.exec(path);
    if (!found || !state.edits.has(found[1])) return response(404, { error: 'missing edit' });
    const [, id, suffix] = found;
    const edit = state.edits.get(id);
    if (method === 'DELETE' && suffix === '') {
      state.edits.delete(id);
      return response(204, null);
    }
    if (method === 'GET' && suffix === '/bundles') {
      return response(200, { bundles: [{ versionCode: Number(internalVersion) }] });
    }
    if (method === 'GET' && suffix === '/tracks') {
      if (mutateOtherOnStagedRead && !state.stagedReadDone &&
          state.calls.some((call) => call.method === 'PUT')) {
        state.stagedReadDone = true;
        edit.tracks.find((track) => track.track === 'production-access').releases[0].status = 'halted';
      }
      return response(200, clone(edit));
    }
    if (method === 'GET' && suffix === '/tracks/internal') {
      return response(200, clone(edit.tracks.find((track) => track.track === 'internal')));
    }
    if (method === 'PUT' && suffix === '/tracks/internal') {
      const updated = JSON.parse(options.body);
      edit.tracks = edit.tracks.map((track) => track.track === 'internal' ? updated : track);
      return response(200, clone(updated));
    }
    if (method === 'POST' && suffix === ':validate') {
      return rejectValidation
        ? response(400, { error: { message: 'Only releases with status draft may be created on draft app' } })
        : response(200, {});
    }
    if (method === 'POST' && suffix === ':commit') {
      state.live = clone(edit);
      state.edits.delete(id);
      return response(200, {});
    }
    return response(404, { error: 'unsupported request ' + method + ' ' + suffix });
  }
  return { state, fetchImpl };
}

const run = (fixture, options = {}) => rolloutInternalRelease({
  token: 'test-credential', fetchImpl: fixture.fetchImpl, ...options,
});

test('activates exactly 100846, verifies completed, and preserves all other Play tracks', async () => {
  const fixture = playFixture();
  const before = structuredClone(fixture.state.live.tracks.slice(1));
  const result = await run(fixture);
  assert.equal(result.versionCode, '100846');
  assert.equal(result.releaseStatus, 'completed');
  assert.equal(result.verifiedAfterCommit, true);
  assert.equal(result.committed, true);
  assert.equal(result.replacedInternalCode, '100810');
  assert.equal(fixture.state.live.tracks[0].releases.length, 1,
    '100846 must supersede only the authenticated older internal release');
  assert.equal(fixture.state.live.tracks[0].releases[0].status, 'completed');
  assert.deepEqual(fixture.state.live.tracks.slice(1), before);
  assert.deepEqual(fixture.state.calls.filter((call) => call.method === 'PUT').map((call) => call.path),
    ['/edits/e1/tracks/internal']);
  assert.equal(fixture.state.calls.filter((call) => call.path.endsWith(':commit')).length, 1);
});

test('activates a single draft 100846 without requiring a prior active internal release', async () => {
  const fixture = playFixture({ includePriorInternal: false });
  const before = structuredClone(fixture.state.live.tracks.slice(1));
  const result = await run(fixture);
  assert.equal(result.versionCode, '100846');
  assert.equal(result.committed, true);
  assert.equal(result.verifiedAfterCommit, true);
  assert.equal(result.replacedInternalCode, null);
  assert.equal(fixture.state.live.tracks[0].releases.length, 1);
  assert.equal(fixture.state.live.tracks[0].releases[0].status, 'completed');
  assert.deepEqual(fixture.state.live.tracks.slice(1), before);
});

test('already completed release is idempotent, with no committed edit or other writes', async () => {
  const fixture = playFixture({ internalStatus: 'completed', includePriorInternal: false });
  const result = await run(fixture);
  assert.equal(result.alreadyActive, true);
  assert.equal(result.committed, false);
  assert.deepEqual(fixture.state.live.tracks[0].releases[0].versionCodes, ['100846']);
  assert.ok(fixture.state.calls.every((call) => call.method !== 'PUT' && !call.path.endsWith(':commit')));
  assert.equal(fixture.state.edits.size, 0);
});

test('rejects missing target bundle and leaves the existing tracks untouched', async () => {
  const fixture = playFixture({ internalVersion: '100845' });
  const before = structuredClone(fixture.state.live);
  await assert.rejects(run(fixture), /Reviewed 100846 AAB is missing/);
  assert.deepEqual(fixture.state.live, before);
  assert.equal(fixture.state.edits.size, 0);
});

test('rejects closed-testing baseline drift and does not publish to internal', async () => {
  const fixture = playFixture({ closedVersion: '100771' });
  await assert.rejects(run(fixture), /qualification release/);
  assert.equal(fixture.state.live.tracks[0].releases[0].status, 'draft');
  assert.equal(fixture.state.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('rejects a multi-release internal track instead of discarding active releases', async () => {
  const fixture = playFixture({ duplicateInternal: true });
  await assert.rejects(run(fixture), /multi-release/);
  assert.equal(fixture.state.live.tracks[0].releases.length, 3);
});

test('Google Play draft-app validation rejection rolls back the uncommitted edit', async () => {
  const fixture = playFixture({ rejectValidation: true });
  await assert.rejects(run(fixture), /Only releases with status draft may be created on draft app/);
  assert.equal(fixture.state.live.tracks[0].releases[0].status, 'draft');
  assert.equal(fixture.state.edits.size, 0);
  assert.equal(fixture.state.calls.filter((call) => call.path.endsWith(':commit')).length, 0);
});

test('rejects changed closed track detected before edit commit', async () => {
  const fixture = playFixture({ mutateOtherOnStagedRead: true });
  await assert.rejects(run(fixture), /non-internal track changed/);
  assert.equal(fixture.state.live.tracks[1].releases[0].status, 'completed');
  assert.equal(fixture.state.calls.filter((call) => call.path.endsWith(':commit')).length, 0);
});

test('rejects unreviewed release code before contacting Google Play', async () => {
  const fixture = playFixture();
  await assert.rejects(run(fixture, { expectedVersionCode: '100847' }), /Only the reviewed Android 100846/);
  assert.equal(fixture.state.calls.length, 0);
});

test('rejects a different active internal version instead of silently replacing it', async () => {
  const fixture = playFixture({ priorInternalVersion: '100014' });
  await assert.rejects(run(fixture), /unreviewed previous internal release/);
  assert.equal(fixture.state.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.equal(fixture.state.live.tracks[0].releases.length, 2);
});

test('rejects previous internal release if not currently completed', async () => {
  const fixture = playFixture({ priorInternalStatus: 'halted' });
  await assert.rejects(run(fixture), /previous internal release is not currently completed/);
  assert.equal(fixture.state.calls.filter((call) => call.method === 'PUT').length, 0);
});
