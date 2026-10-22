// Activate the already-uploaded Pack One Android 100925 bundle without
// staging a draft or rebuilding the app. The existing internal 100858
// testers remain on their completed release if any check fails before commit.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'pro.packone.app';
const INTERNAL = 'internal';
const CLOSED = 'production-access';
const TARGET = '100925';
const CURRENT = '100858';
const CLOSED_CODE = '100772';

const codes = (release) => (release.versionCodes || []).map(String);
const releases = (track) => Array.isArray(track?.releases) ? track.releases : [];
const completed = (release, code) =>
  release.status === 'completed' && codes(release).length === 1 && codes(release)[0] === code;
const clone = (value) => JSON.parse(JSON.stringify(value));

function otherTracks(tracks) {
  assert.ok(Array.isArray(tracks?.tracks), 'Google Play track inventory missing.');
  return clone(tracks.tracks
    .filter((track) => track.track !== INTERNAL)
    .sort((a, b) => a.track.localeCompare(b.track)));
}
function assertClosed(tracks) {
  const closed = tracks.tracks.find((track) => track.track === CLOSED);
  assert.ok(closed, 'Existing production-access Closed Testing track is missing.');
  assert.ok(releases(closed).some((r) => completed(r, CLOSED_CODE)),
    'Closed Testing 100772 qualification baseline changed; refusing Internal Testing rollout.');
}
function currentInternal(internal) {
  assert.equal(internal?.track, INTERNAL, 'Existing internal track missing.');
  assert.equal(releases(internal).length, 1,
    'Refusing ambiguous internal track; exactly one completed release is required.');
  const [release] = releases(internal);
  assert.ok(
    completed(release, CURRENT) || completed(release, TARGET),
    'Internal Testing is not exactly completed 100858 or 100925; refusing to replace it.',
  );
  return release;
}

export async function activateImportedInternal925({
  token,
  fetchImpl = globalThis.fetch,
  targetVersionCode = TARGET,
} = {}) {
  assert.ok(typeof token === 'string' && token.trim(), 'Google Play token required.');
  assert.equal(targetVersionCode, TARGET, 'Only reviewed Android 100925 activation is authorized.');
  const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE;

  async function req(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = raw; }
    }
    if (!response.ok) throw Error('Google Play ' + method + ' ' + path
      + ' returned HTTP ' + response.status + ': ' + JSON.stringify(data));
    return data;
  }
  async function newEdit() {
    const edit = await req('/edits', { method: 'POST', body: {} });
    assert.ok(edit?.id, 'Google Play did not issue a release edit.');
    return encodeURIComponent(edit.id);
  }
  async function discardEdit(id) {
    try { await req('/edits/' + id, { method: 'DELETE' }); }
    catch (err) { console.error('Unable to discard uncommitted Google Play edit: ' + err.message); }
  }

  let editId;
  let committed = false;
  let beforeOther;
  const releaseName = 'Pack One internal 100925';
  try {
    editId = await newEdit();
    const prefix = '/edits/' + editId;
    const [inventory, bundles, internal] = await Promise.all([
      req(prefix + '/tracks'), req(prefix + '/bundles'), req(prefix + '/tracks/' + INTERNAL),
    ]);
    assertClosed(inventory);
    beforeOther = otherTracks(inventory);
    assert.ok(inventory.tracks.some((track) => track.track === INTERNAL),
      'Refusing to create a new internal track.');
    assert.ok((bundles?.bundles || []).some((bundle) => String(bundle.versionCode) === TARGET),
      'Signed AAB 100925 is not in the Play bundle library; refusing activation.');
    const prior = currentInternal(internal);
    if (completed(prior, TARGET)) {
      return {
        packageName: PACKAGE, track: INTERNAL, versionCode: TARGET,
        releaseName: prior.name, replacedInternalCode: null,
        releaseStatus: 'completed', alreadyActive: true, committed: false,
        verifiedAfterCommit: false, closedTrackPreserved: true, otherTracksPreserved: true,
      };
    }
    assert.ok(completed(prior, CURRENT), 'Expected current Internal 100858 to be completed.');

    // Single Play edit. No draft state is committed and no other track is written.
    await req(prefix + '/tracks/' + INTERNAL, {
      method: 'PUT',
      body: {
        ...internal,
        releases: [{ name: releaseName, status: 'completed', versionCodes: [TARGET] }],
      },
    });
    const staged = await req(prefix + '/tracks');
    assert.deepEqual(otherTracks(staged), beforeOther,
      'A non-internal Play track changed in the release edit; refusing commit.');
    assertClosed(staged);
    const stagedInternal = staged.tracks.find((track) => track.track === INTERNAL);
    assert.ok(completed(currentInternal(stagedInternal), TARGET),
      'Play did not stage exactly one completed 100925 Internal Testing release.');
    await req(prefix + ':validate', { method: 'POST', body: {} });
    await req(prefix + ':commit', { method: 'POST', body: {} });
    committed = true;
  } finally {
    if (editId && !committed) await discardEdit(editId);
  }

  let verifyId;
  try {
    verifyId = await newEdit();
    const prefix = '/edits/' + verifyId;
    const inventory = await req(prefix + '/tracks');
    assert.deepEqual(otherTracks(inventory), beforeOther,
      'A non-internal Play track changed after commit. Inspect Google Play immediately.');
    assertClosed(inventory);
    const internal = await req(prefix + '/tracks/' + INTERNAL);
    const release = currentInternal(internal);
    assert.ok(completed(release, TARGET),
      'The new Internal Testing 100925 release did not verify as completed.');
    assert.equal(release.name, releaseName, 'Verified release name does not match reviewed target.');
  } finally {
    if (verifyId) await discardEdit(verifyId);
  }
  return {
    packageName: PACKAGE, track: INTERNAL, versionCode: TARGET,
    releaseName, replacedInternalCode: CURRENT,
    releaseStatus: 'completed', alreadyActive: false, committed: true,
    verifiedAfterCommit: true, closedTrackPreserved: true, otherTracksPreserved: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await activateImportedInternal925({
    token: process.env.PLAY_ACCESS_TOKEN?.trim(),
    targetVersionCode: process.argv[2],
  });
  console.log(JSON.stringify(data));
}
