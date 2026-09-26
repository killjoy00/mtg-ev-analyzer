import { readFileSync } from 'node:fs';

const token = process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName = process.env.PACKONE_ANDROID_PACKAGE?.trim() || 'pro.packone.app';
const releaseTarget = process.env.PACKONE_PLAY_TARGET?.trim() || 'internal';
const track = process.env.PACKONE_PLAY_TRACK?.trim() || 'internal';
const bundlePath = process.argv[2];

if (!['internal', 'closed'].includes(releaseTarget)) {
  throw new Error('PACKONE_PLAY_TARGET must be internal or closed.');
}
if (!/^[A-Za-z0-9._-]{1,100}$/.test(track)) {
  throw new Error('PACKONE_PLAY_TRACK is malformed.');
}
if (releaseTarget === 'internal' && track !== 'internal') {
  throw new Error('Internal releases must target the internal track.');
}
if (releaseTarget === 'closed' && ['internal', 'production', 'beta', 'qa'].includes(track)) {
  throw new Error('Closed releases require an explicit custom closed-testing track.');
}

if (!token) throw new Error('PLAY_ACCESS_TOKEN is required.');
if (!bundlePath) throw new Error('Usage: node play-internal-release.mjs /path/to/app-release.aab');

const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
const uploadBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}`;

async function request(url, { method = 'GET', body, contentType = 'application/json' } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': contentType }),
    },
    body,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(
      `${method} ${url} failed with HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
    );
  }
  return data;
}

let editId = null;
let committed = false;

try {
  const edit = await request(`${apiBase}/edits`, {
    method: 'POST',
    body: '{}',
  });
  editId = edit?.id;
  if (!editId) throw new Error('Google Play did not return an edit ID.');

  const uploaded = await request(
    `${uploadBase}/edits/${encodeURIComponent(editId)}/bundles?uploadType=media`,
    {
      method: 'POST',
      body: readFileSync(bundlePath),
      contentType: 'application/octet-stream',
    },
  );

  const versionCode = String(uploaded?.versionCode ?? '');
  if (!versionCode) throw new Error('Google Play did not return an uploaded version code.');

  const releaseName = `Pack One ${releaseTarget} ${process.env.GITHUB_SHA?.slice(0, 7) || versionCode}`;
  await request(
    `${apiBase}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        track,
        releases: [
          {
            name: releaseName,
            status: 'draft',
            versionCodes: [versionCode],
          },
        ],
      }),
    },
  );

  await request(
    `${apiBase}/edits/${encodeURIComponent(editId)}:commit`,
    { method: 'POST', body: '{}' },
  );
  committed = true;

  process.stdout.write(
    JSON.stringify({
      packageName,
      target: releaseTarget,
      track,
      versionCode,
      releaseName,
      releaseStatus: 'draft',
      committed: true,
    }),
  );
} finally {
  if (editId && !committed) {
    try {
      await request(`${apiBase}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE' });
    } catch (cleanupError) {
      console.error(`Failed to delete abandoned Google Play edit ${editId}: ${cleanupError.message}`);
    }
  }
}
