import test from 'node:test';
import assert from 'node:assert/strict';
import { activateResultsInternal970 } from '../scripts/activate-results-android-internal.mjs';

function fixture({
  internalVersion = '100925',
  internalStatus = 'completed',
  closedVersion = '100963',
  closedStatus = 'completed',
  targetBundleAvailable = true,
  extraInternal = false,
  mutateClosedAfterPut = false,
  rejectValidation = false,
  rejectCommit = false,
} = {}) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = {
    live: { tracks: [
      { track: 'internal', releases: [
        { name: 'Pack One internal 100925', status: internalStatus, versionCodes: [internalVersion] },
        ...(extraInternal ? [{ name: 'unexpected extra', status: 'draft', versionCodes: ['100900'] }] : []),
      ] },
      { track: 'production-access', releases: [
        { name: 'Pack One closed', status: closedStatus, versionCodes: [closedVersion] },
      ] },
      { track: 'production', releases: [] },
    ] },
    edits: new Map(), next: 0, calls: [], stagedMutationDone: false,
  };
  const response = (status, data) => ({
    status, ok: status >= 200 && status < 300,
    async text() { return data == null ? '' : JSON.stringify(data); },
  });

  async function fetchImpl(url, options = {}) {
    const method = options.method || 'GET';
    const path = new URL(url).pathname.split('/applications/pro.packone.app')[1];
    state.calls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/edits' && method === 'POST') {
      const id = 'e' + (++state.next);
      state.edits.set(id, clone(state.live));
      return response(200, { id });
    }
    const found = /^\/edits\/(e[0-9]+)(.*)$/.exec(path);
    if (!found || !state.edits.has(found[1])) return response(404, { error: 'missing edit' });
    const [, id, suffix] = found;
    const edit = state.edits.get(id);
    if (method === 'DELETE' && !suffix) {
      state.edits.delete(id);
      return response(204, null);
    }
    if (method === 'GET' && suffix === '/bundles') {
      return response(200, { bundles: targetBundleAvailable ? [{ versionCode: 100970 }] : [{ versionCode: 100925 }] });
    }
    if (method === 'GET' && suffix === '/tracks') {
      if (mutateClosedAfterPut && !state.stagedMutationDone &&
          state.calls.some((c) => c.method === 'PUT')) {
        state.stagedMutationDone = true;
        edit.tracks.find((t) => t.track === 'production-access').releases[0].status = 'halted';
      }
      return response(200, clone(edit));
    }
    if (method === 'GET' && suffix === '/tracks/internal') {
      return response(200, clone(edit.tracks.find((t) => t.track === 'internal')));
    }
    if (method === 'PUT' && suffix === '/tracks/internal') {
      const updated = JSON.parse(options.body);
      edit.tracks = edit.tracks.map((t) => t.track === 'internal' ? updated : t);
      return response(200, clone(updated));
    }
    if (method === 'POST' && suffix === ':validate') {
      return rejectValidation
        ? response(400, { error: 'Play rejected the proposed internal update' })
        : response(200, {});
    }
    if (method === 'POST' && suffix === ':commit') {
      if (rejectCommit) return response(409, { error: 'Play rejected the commit' });
      state.live = clone(edit);
      state.edits.delete(id);
      return response(200, {});
    }
    return response(404, { error: 'unexpected operation ' + method + ' ' + suffix });
  }
  return { state, fetchImpl };
}

const run = (f, overrides = {}) =>
  activateResultsInternal970({ token: 'unit-test-credential', fetchImpl: f.fetchImpl, ...overrides });

test('activates imported 100970 atomically, replaces 100925 and preserves all noninternal tracks', async () => {
  const f = fixture();
  const other = structuredClone(f.state.live.tracks.slice(1));
  const output = await run(f);
  assert.equal(output.track, 'internal');
  assert.equal(output.versionCode, '100970');
  assert.equal(output.replacedInternalCode, '100925');
  assert.equal(output.releaseStatus, 'completed');
  assert.equal(output.committed, true);
  assert.equal(output.verifiedAfterCommit, true);
  assert.equal(output.closedTrackPreserved, true);
  assert.equal(f.state.live.tracks[0].releases.length, 1);
  assert.equal(f.state.live.tracks[0].releases[0].status, 'completed');
  assert.deepEqual(f.state.live.tracks[0].releases[0].versionCodes, ['100970']);
  assert.deepEqual(f.state.live.tracks.slice(1), other);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 1);
  assert.equal(f.state.calls.filter((c) => c.path.endsWith(':commit')).length, 1);
  assert.equal(f.state.edits.size, 0);
});

test('already completed 100970 is idempotent with no track writes', async () => {
  const f = fixture({ internalVersion: '100970' });
  const output = await run(f);
  assert.equal(output.alreadyActive, true);
  assert.equal(output.committed, false);
  assert.equal(output.releaseStatus, 'completed');
  assert.ok(f.state.calls.every((c) => c.method !== 'PUT' && !c.path.endsWith(':commit')));
  assert.equal(f.state.edits.size, 0);
});

test('activates only the reviewed uploaded 100970 draft, including with its prior completed internal release',async()=>{
  for(const prior of [false,true]){
    const f=fixture({internalVersion:'100970',internalStatus:'draft'});
    if(prior)f.state.live.tracks[0].releases.push({name:'prior',status:'completed',versionCodes:['100925']});
    const other=structuredClone(f.state.live.tracks.slice(1));
    const result=await run(f);assert.equal(result.releaseStatus,'completed');assert.equal(result.verifiedAfterCommit,true);
    assert.deepEqual(f.state.live.tracks.slice(1),other);
  }
});

test('refuses unreviewed version before Play API access', async () => {
  const f = fixture();
  await assert.rejects(run(f, { targetVersionCode: '100926' }), /Only reviewed Android 100970/);
  assert.equal(f.state.calls.length, 0);
});

test('refuses activation if new signed AAB is not in the bundle library', async () => {
  const f = fixture({ targetBundleAvailable: false });
  await assert.rejects(run(f), /Signed AAB 100970 is not in the Play bundle library/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 0);
  assert.equal(f.state.edits.size, 0);
});

test('refuses to replace a different internal version', async () => {
  const f = fixture({ internalVersion: '100854' });
  await assert.rejects(run(f), /Only existing completed 100925/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('refuses to disrupt an incomplete or draft internal release', async () => {
  const f = fixture({ internalStatus: 'draft' });
  await assert.rejects(run(f), /Only existing completed 100925/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('refuses unexpected multi-release internal track', async () => {
  const f = fixture({ extraInternal: true });
  await assert.rejects(run(f), /Only existing completed 100925/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('does not call two completed internal releases an exact active candidate',async()=>{
  const f=fixture({internalVersion:'100970'});
  f.state.live.tracks[0].releases.push({name:'prior',status:'completed',versionCodes:['100925']});
  await assert.rejects(run(f),/unrelated or duplicate internal releases/);
  assert.ok(f.state.calls.every(c=>c.method!=='PUT'));
});

test('rejects closed-test qualification drift', async () => {
  const f = fixture({ closedVersion: '100771' });
  await assert.rejects(run(f), /Closed Testing 100963 qualification baseline changed/);
  assert.equal(f.state.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('refuses to commit if another track changed within staged edit', async () => {
  const f = fixture({ mutateClosedAfterPut: true });
  const before = structuredClone(f.state.live);
  await assert.rejects(run(f), /non-internal Play track changed/);
  assert.deepEqual(f.state.live, before);
  assert.equal(f.state.calls.filter((c) => c.path.endsWith(':commit')).length, 0);
  assert.equal(f.state.edits.size, 0);
});

test('Play validation rejection discards edit without impacting active testers', async () => {
  const f = fixture({ rejectValidation: true });
  const before = structuredClone(f.state.live);
  await assert.rejects(run(f), /operation returned HTTP 400/);
  assert.deepEqual(f.state.live, before);
  assert.equal(f.state.calls.filter((c) => c.path.endsWith(':commit')).length, 0);
  assert.equal(f.state.edits.size, 0);
});

test('Play commit rejection keeps current completed release', async () => {
  const f = fixture({ rejectCommit: true });
  const before = structuredClone(f.state.live);
  await assert.rejects(run(f), /operation returned HTTP 409/);
  assert.deepEqual(f.state.live, before);
  assert.equal(f.state.edits.size, 0);
});
