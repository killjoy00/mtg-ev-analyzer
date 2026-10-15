import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'pro.packone.app';
const INTERNAL = 'internal';
const CLOSED = 'production-access';
const TARGET_CODE = '100853';
const CLOSED_CODE = '100772';

function releasesFor(track) {
  return Array.isArray(track?.releases) ? track.releases : [];
}

function singleRelease(track, versionCode) {
  assert.equal(track?.track, INTERNAL, 'Expected the existing internal track.');
  const releases = releasesFor(track);
  assert.ok(releases.length >= 1 && releases.length <= 2,
    'Refusing an unexpected multi-release internal track.');
  const target = releases.filter((release) =>
    JSON.stringify((release.versionCodes || []).map(String)) === JSON.stringify([versionCode]));
  assert.equal(target.length, 1, 'Expected exactly one reviewed 100853 internal release.');
  const release = target[0];
  assert.ok(['draft', 'completed'].includes(release.status),
    'Internal target release has an unexpected status.');

  const existing = releases.filter((candidate) => candidate !== release);
  if (existing.length) {
    assert.equal(existing.length, 1, 'Refusing multiple old internal releases.');
    assert.deepEqual((existing[0].versionCodes || []).map(String), ['100849'],
      'Refusing to displace an unreviewed previous internal release.');
    assert.equal(existing[0].status, 'completed',
      'The previous internal release is not currently completed.');
    assert.equal(release.status, 'draft',
      'Refusing to rewrite a completed 100853 release alongside a fallback.');
  }
  return release;
}

function otherTracks(tracks) {
  assert.ok(Array.isArray(tracks?.tracks), 'Google Play returned no track inventory.');
  return tracks.tracks
    .filter((track) => track.track !== INTERNAL)
    .sort((a, b) => a.track.localeCompare(b.track));
}

function assertClosedPreserved(tracks, expectedCode) {
  const closed = otherTracks(tracks).find((track) => track.track === CLOSED);
  assert.ok(closed, 'Existing production-access Closed Testing track is missing.');
  assert.ok(releasesFor(closed).some((release) =>
    release.status === 'completed' && (release.versionCodes || []).map(String).includes(expectedCode)),
  'Closed Testing qualification release is not the expected active version; refusing rollout.');
  return closed;
}

export async function rolloutInternalRelease({
  token,
  fetchImpl = globalThis.fetch,
  expectedVersionCode = TARGET_CODE,
  expectedClosedVersionCode = CLOSED_CODE,
} = {}) {
  assert.ok(token && typeof token === 'string', 'Google Play access token required.');
  assert.equal(expectedVersionCode, TARGET_CODE, 'Only the reviewed Android 100853 rollout is authorized.');
  assert.equal(expectedClosedVersionCode, CLOSED_CODE,
    'Do not change the approved production-access Closed Testing baseline.');
  const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE;

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(base + path, {
      method,
      headers: {
        authorization: 'Bearer ' + token,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      throw Error('Google Play ' + method + ' ' + path + ' returned HTTP ' +
        response.status + ': ' + (typeof data === 'string' ? data : JSON.stringify(data)));
    }
    return data;
  }

  async function newEdit() {
    const edit = await request('/edits', { method: 'POST', body: {} });
    assert.ok(edit?.id, 'Google Play did not issue an edit.');
    return encodeURIComponent(edit.id);
  }

  async function deleteEdit(id) {
    try { await request('/edits/' + id, { method: 'DELETE' }); }
    catch (error) { console.error('Unable to dispose Google Play edit: ' + error.message); }
  }

  let editId = null;
  let committed = false;
  let releaseName;
  let priorStatus;
  let replacedInternalCode = null;
  let beforeOther;
  try {
    editId = await newEdit();
    const prefix = '/edits/' + editId;
    const [inventory, bundles, internal] = await Promise.all([
      request(prefix + '/tracks'),
      request(prefix + '/bundles'),
      request(prefix + '/tracks/' + INTERNAL),
    ]);
    assert.ok((bundles?.bundles || []).some((bundle) =>
      String(bundle.versionCode) === expectedVersionCode),
    'Reviewed 100853 AAB is missing from Google Play; refusing a rebuild or substitution.');
    assertClosedPreserved(inventory, expectedClosedVersionCode);
    beforeOther = otherTracks(inventory);
    assert.ok(inventory.tracks.some((track) => track.track === INTERNAL),
      'Refusing to create a new internal track.');
    const release = singleRelease(internal, expectedVersionCode);
    replacedInternalCode = releasesFor(internal).length === 2 ? '100849' : null;
    releaseName = release.name;
    priorStatus = release.status;

    if (release.status === 'completed') {
      return {
        packageName: PACKAGE, track: INTERNAL, versionCode: expectedVersionCode,
        releaseName, priorStatus, releaseStatus: 'completed',
        committed: false, alreadyActive: true, closedTrackPreserved: true,
        replacedInternalCode: null,
      };
    }

    await request(prefix + '/tracks/' + INTERNAL, {
      method: 'PUT',
      body: { ...internal, releases: [{ ...release, status: 'completed' }] },
    });

    const inEdit = await request(prefix + '/tracks');
    assert.deepEqual(otherTracks(inEdit), beforeOther,
      'A non-internal track changed inside the edit; refusing commit.');
    assertClosedPreserved(inEdit, expectedClosedVersionCode);
    const editedInternal = inEdit.tracks.find((track) => track.track === INTERNAL);
    assert.equal(singleRelease(editedInternal, expectedVersionCode).status, 'completed',
      'Google Play did not stage the completed internal release.');

    await request(prefix + ':validate', { method: 'POST', body: {} });
    await request(prefix + ':commit', { method: 'POST', body: {} });
    committed = true;
  } finally {
    if (editId && !committed) await deleteEdit(editId);
  }

  let verifyEdit = null;
  try {
    verifyEdit = await newEdit();
    const prefix = '/edits/' + verifyEdit;
    const all = await request(prefix + '/tracks');
    assert.deepEqual(otherTracks(all), beforeOther,
      'A non-internal track changed after the rollout. Inspect Google Play.');
    assertClosedPreserved(all, expectedClosedVersionCode);
    const internal = await request(prefix + '/tracks/' + INTERNAL);
    assert.equal(singleRelease(internal, expectedVersionCode).status, 'completed',
      'The committed Android internal rollout did not verify as completed.');
    assert.equal(singleRelease(internal, expectedVersionCode).name, releaseName,
      'Google Play internal release identity changed during verification.');
  } finally {
    if (verifyEdit) await deleteEdit(verifyEdit);
  }

  return {
    packageName: PACKAGE, track: INTERNAL, versionCode: expectedVersionCode,
    releaseName, priorStatus, releaseStatus: 'completed', committed: true,
    alreadyActive: false, closedTrackPreserved: true, verifiedAfterCommit: true,
    replacedInternalCode,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await rolloutInternalRelease({
    token: process.env.PLAY_ACCESS_TOKEN?.trim(),
    expectedVersionCode: process.argv[2],
  });
  console.log(JSON.stringify(result));
}
