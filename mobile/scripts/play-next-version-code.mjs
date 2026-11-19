import { appendFileSync } from 'node:fs';

const token = process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName = process.env.PACKONE_ANDROID_PACKAGE?.trim() || 'pro.packone.app';
const runNumber = Number(process.env.GITHUB_RUN_NUMBER || '0');
const maxVersionCode = 2_100_000_000;

if (!token) throw new Error('PLAY_ACCESS_TOKEN is required.');
if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
  throw new Error('GITHUB_RUN_NUMBER must be a positive integer.');
}

const apiBase = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;

async function request(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
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
try {
  const edit = await request(`${apiBase}/edits`, { method: 'POST', body: '{}' });
  editId = edit?.id;
  if (!editId) throw new Error('Google Play did not return an edit ID.');

  const bundles = await request(
    `${apiBase}/edits/${encodeURIComponent(editId)}/bundles`,
  );

  let highestStoreVersionCode = 0;
  for (const bundle of bundles?.bundles || []) {
    const versionCode = Number(bundle?.versionCode);
    if (Number.isSafeInteger(versionCode) && versionCode > 0) {
      highestStoreVersionCode = Math.max(highestStoreVersionCode, versionCode);
    }
  }

  const workflowFloor = 100000 + runNumber;
  const nextVersionCode = Math.max(highestStoreVersionCode + 1, workflowFloor);
  if (nextVersionCode > maxVersionCode) {
    throw new Error(`Computed Android versionCode ${nextVersionCode} exceeds ${maxVersionCode}.`);
  }

  console.log(JSON.stringify({
    packageName,
    highestStoreVersionCode,
    workflowFloor,
    nextVersionCode,
  }));

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `highest_store_version_code=${highestStoreVersionCode}`,
        `workflow_floor=${workflowFloor}`,
        `next_version_code=${nextVersionCode}`,
        '',
      ].join('\n'),
    );
  }
} finally {
  if (editId) {
    try {
      await request(`${apiBase}/edits/${encodeURIComponent(editId)}`, { method: 'DELETE' });
    } catch (cleanupError) {
      console.error(`Failed to delete version-code probe edit ${editId}: ${cleanupError.message}`);
    }
  }
}
