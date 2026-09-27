const token = process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName = process.env.PACKONE_ANDROID_PACKAGE?.trim() || 'pro.packone.app';
const versionCode = String(process.argv[2] || '').trim();
const track = String(process.argv[3] || 'alpha').trim();

if (!token) throw new Error('PLAY_ACCESS_TOKEN is required.');
if (!/^[1-9][0-9]*$/.test(versionCode)) throw new Error('A valid Google Play version code is required.');
if (!/^[a-z0-9._-]{1,80}$/.test(track) || ['internal', 'beta', 'production'].includes(track)) {
  throw new Error(`Refusing non-closed target track: ${track}`);
}

const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;

async function request(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} failed with HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

let editId = null;
let committed = false;

try {
  const edit = await request(`${apiBase}/edits`, { method: 'POST', body: '{}' });
  editId = edit?.id;
  if (!editId) throw new Error('Google Play did not return an edit ID.');

  const [bundles, tracks] = await Promise.all([
    request(`${apiBase}/edits/${encodeURIComponent(editId)}/bundles`),
    request(`${apiBase}/edits/${encodeURIComponent(editId)}/tracks`),
  ]);

  const availableVersionCodes = (bundles?.bundles || []).map((bundle) => String(bundle.versionCode));
  if (!availableVersionCodes.includes(versionCode)) {
    throw new Error(`Google Play does not contain uploaded bundle versionCode ${versionCode}.`);
  }

  const trackNames = (tracks?.tracks || []).map((item) => String(item.track));
  let createdTrack = false;
  if (!trackNames.includes(track)) {
    await request(
      `${apiBase}/edits/${encodeURIComponent(editId)}/tracks`,
      {
        method: 'POST',
        body: JSON.stringify({
          track,
          type: 'CLOSED_TESTING',
          formFactor: 'DEFAULT',
        }),
      },
    );
    createdTrack = true;
  }

  const releaseName = `Pack One closed ${process.env.GITHUB_SHA?.slice(0, 7) || versionCode}`;
  let releaseStatus = 'completed';
  let requiresConsoleRollout = false;

  const updateTrack = async (status) => request(
    `${apiBase}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        track,
        releases: [{
          name: releaseName,
          status,
          versionCodes: [versionCode],
        }],
      }),
    },
  );

  await updateTrack(releaseStatus);

  try {
    await request(`${apiBase}/edits/${encodeURIComponent(editId)}:validate`, {
      method: 'POST',
      body: '{}',
    });
  } catch (error) {
    if (!/Only releases with status draft may be created on draft app/i.test(error?.message || '')) {
      throw error;
    }
    releaseStatus = 'draft';
    requiresConsoleRollout = true;
    await updateTrack(releaseStatus);
    await request(`${apiBase}/edits/${encodeURIComponent(editId)}:validate`, {
      method: 'POST',
      body: '{}',
    });
  }
  await request(`${apiBase}/edits/${encodeURIComponent(editId)}:commit`, {
    method: 'POST',
    body: '{}',
  });
  committed = true;

  process.stdout.write(JSON.stringify({
    packageName,
    track,
    versionCode,
    releaseName,
    releaseStatus,
    requiresConsoleRollout,
    committed: true,
    availableTracks: createdTrack ? [...trackNames, track] : trackNames,
    createdTrack,
  }));
} finally {
  if (editId && !committed) {
    try {
      await request(`${apiBase}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE' });
    } catch (cleanupError) {
      console.error(`Failed to delete abandoned Google Play edit ${editId}: ${cleanupError.message}`);
    }
  }
}
